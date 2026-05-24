import 'server-only';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { generateTokenHex, sha256Hex } from '@/lib/auth/token-hash';
import { isUniqueViolationOn } from '@/lib/prisma/errors';

// CANDID-010 Step 3 — 이메일 인증 토큰 검증 + 재발송.
// US-AUTH-001: 24h 토큰 + 60초 재발송 쿨다운. BR-AUTH-04: 미인증 사용자는 지원서 제출만 차단.
//
// CANDID-036 (Step 2) race fix — db-designer 권고 Option C 채택:
//   - consumeVerificationToken: `updateMany WHERE consumedAt=null AND expiresAt>now`로
//     PostgreSQL UPDATE row lock 자연 직렬화. `findUnique`+분기+`update` 사이 race window 제거.
//   - resendVerificationEmail: `uk_email_verifications_active_per_user` 부분 UNIQUE
//     (CANDID-036 Step 1 마이그레이션) 위반 시 P2002 → AUTH_VERIFICATION_RESEND_COOLDOWN 매핑.
//
// CANDID-037 (Step 2) 정밀화 — db-designer 분석 + L-025:
//   - 격리 수준 가정: PostgreSQL 기본 READ COMMITTED. 부분 UNIQUE는 인덱스 레벨에서 평가되어
//     격리 수준과 독립적 (REPEATABLE READ로 격상해도 P2002 차단 동작 동일).
//   - P2002 매핑 정밀화: `email_verifications`에 P2002를 던질 UNIQUE 인덱스가 2개 존재한다.
//       (a) `uk_email_verifications_active_per_user` (부분 UNIQUE) → race-cooldown 시맨틱
//       (b) `email_verifications_token_hash_key` (sha256 충돌) → 사실상 시스템 에러
//     `isUniqueViolationOn(err, ['uk_email_verifications_active_per_user'])` 화이트리스트로만
//     cooldown 매핑. 다른 인덱스 충돌은 SYS_INTERNAL_ERROR 전파 (잘못된 cooldown 응답 차단).
//   - 진입부 가드: 이미 `emailVerifiedAt != null`인 사용자는 race로 INSERT까지 가지 않게
//     단축 차단 (AUTH_EMAIL_ALREADY_VERIFIED 409). 부분 UNIQUE는 mass mailing race를 막지만,
//     이미 인증된 사용자의 의미 없는 재발송 시도까지 자원 낭비를 막는다.

/** 인증 토큰 유효기간 24시간 (US-AUTH-001). */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** 재발송 쿨다운 60초 (US-AUTH-001). */
const RESEND_COOLDOWN_MS = 60 * 1000;
/**
 * P2002 매핑 화이트리스트 — 본 인덱스의 충돌만 race-cooldown 시맨틱으로 매핑한다.
 * `email_verifications_token_hash_key`(sha256 충돌)는 시스템 에러로 전파.
 */
const RESEND_COOLDOWN_UNIQUE_INDEXES = [
  'uk_email_verifications_active_per_user',
] as const;

export interface ConsumeResult {
  userId: number;
  emailVerifiedAt: Date;
  /** 멱등 응답 — 이미 인증 완료된 토큰을 재요청한 경우. */
  alreadyVerified: boolean;
}

export interface ResendResult {
  /** 평문 토큰 — 메일 발송 인자. 응답에는 포함 금지. */
  verificationToken: string;
  /** 다음 재발송 가능 시각 (now + 60s). */
  nextResendAvailableAt: Date;
}

/**
 * 평문 토큰을 sha256으로 해시하여 emailVerification row를 소진한다.
 *
 * CANDID-036 race fix: `updateMany WHERE consumedAt=null AND expiresAt>now`를
 * 단일 UPDATE 문으로 실행 → PostgreSQL이 일치 row에 ExclusiveLock 자동 획득.
 * 동시 두 트랜잭션이 같은 토큰을 클릭해도 첫 UPDATE만 count=1, 두 번째는 count=0
 * (consumedAt이 이미 set되어 WHERE 조건 불일치). 사후 `findUnique`로 부재/만료/멱등 분류.
 *
 * 격리 수준: PostgreSQL 기본 READ COMMITTED 가정. UPDATE의 자동 row lock으로 race-free
 * 직렬화가 보장되므로 REPEATABLE READ로 격상해도 동작은 동일하다.
 *
 * - 토큰 부재: 400 AUTH_VERIFICATION_TOKEN_INVALID
 * - 만료: 410 AUTH_VERIFICATION_TOKEN_EXPIRED
 * - 이미 소진된 토큰 재클릭: 멱등 응답 (alreadyVerified=true)
 */
export async function consumeVerificationToken(token: string): Promise<ConsumeResult> {
  const tokenHash = sha256Hex(token);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    // race-free 직렬화 — UPDATE의 row lock이 동시 두 요청 중 하나만 통과시킨다.
    const result = await tx.emailVerification.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });

    if (result.count === 0) {
      // 사후 분류 — 부재 / 이미 소진(멱등) / 만료
      const row = await tx.emailVerification.findUnique({
        where: { tokenHash },
        select: {
          userId: true,
          consumedAt: true,
          expiresAt: true,
          user: { select: { emailVerifiedAt: true } },
        },
      });
      if (row === null) {
        throw new AppError('AUTH_VERIFICATION_TOKEN_INVALID');
      }
      if (row.consumedAt !== null) {
        // 멱등 — 이미 소진된 정상 토큰을 재클릭 (이메일 더블 클릭 또는 race 패자)
        const emailVerifiedAt = row.user.emailVerifiedAt ?? row.consumedAt;
        return { userId: row.userId, emailVerifiedAt, alreadyVerified: true };
      }
      // count=0 && consumedAt=null → WHERE 불일치 사유는 expiresAt만 남음 (만료).
      throw new AppError('AUTH_VERIFICATION_TOKEN_EXPIRED');
    }

    // count=1 — 직렬화 승자. user.emailVerifiedAt 갱신.
    const row = await tx.emailVerification.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    // count=1이면 방금 UPDATE한 row가 반드시 존재 — non-null 단언 안전.
    if (row === null) {
      // 방어적 — 동일 트랜잭션 내 ghost row (이론상 불가). 일관성 위배.
      throw new AppError('SYS_INTERNAL_ERROR');
    }
    await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
    return { userId: row.userId, emailVerifiedAt: now, alreadyVerified: false };
  });
}

/**
 * 인증 메일 재발송 — 진입 가드 + 60초 쿨다운 + 기존 활성 토큰 invalidate + 신규 토큰 발행.
 *
 * 진입 시점 가드 순서 (CANDID-037):
 *   1. user 조회 — 부재 시 USER_NOT_FOUND (인증된 userId의 race deletion 방어)
 *   2. emailVerifiedAt 사전 차단 — AUTH_EMAIL_ALREADY_VERIFIED (자원 낭비 방지)
 *   3. 활성 토큰 60초 쿨다운 검증 (트랜잭션 외부)
 *   4. 트랜잭션: 기존 활성 토큰 invalidate + 신규 INSERT
 *   5. P2002 catch — `uk_email_verifications_active_per_user` 인덱스만 cooldown으로 매핑 (L-025)
 *
 * 격리 수준: PostgreSQL READ COMMITTED 가정. 부분 UNIQUE 제약은 격리 수준과 독립적이므로
 * REPEATABLE READ로 격상해도 race 차단 동작 동일.
 */
export async function resendVerificationEmail(
  userId: number,
  now: Date = new Date(),
): Promise<ResendResult> {
  // 1) 진입 가드 — user 부재 / 이미 인증 (CANDID-037 D3)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  if (user === null) {
    // requireAuth 통과 후 race deletion (회원 탈퇴 등). 시스템 inconsistency.
    throw new AppError('USER_NOT_FOUND');
  }
  if (user.emailVerifiedAt !== null) {
    throw new AppError('AUTH_EMAIL_ALREADY_VERIFIED');
  }

  // 2) 활성(미소진/미만료) 토큰 중 가장 최근 row 조회 — 쿨다운 기준점.
  const active = await prisma.emailVerification.findFirst({
    where: { userId, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { lastSentAt: 'desc' },
    select: { id: true, lastSentAt: true },
  });
  if (active !== null) {
    const elapsed = now.getTime() - active.lastSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      throw new AppError('AUTH_VERIFICATION_RESEND_COOLDOWN');
    }
  }

  const verificationToken = generateTokenHex(32);
  const tokenHash = sha256Hex(verificationToken);
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);

  try {
    await prisma.$transaction(async (tx) => {
      // 기존 활성 토큰 invalidate (보안 — 이전 토큰 즉시 무효)
      if (active !== null) {
        await tx.emailVerification.update({
          where: { id: active.id },
          data: { consumedAt: now },
        });
      }
      await tx.emailVerification.create({
        data: { userId, tokenHash, expiresAt, lastSentAt: now },
      });
    });
  } catch (err) {
    // L-025 정밀 매핑 — `uk_email_verifications_active_per_user` 충돌만 cooldown 시맨틱.
    // `token_hash` UNIQUE 충돌(사실상 sha256 collision)은 시스템 에러로 전파.
    if (isUniqueViolationOn(err, RESEND_COOLDOWN_UNIQUE_INDEXES)) {
      throw new AppError('AUTH_VERIFICATION_RESEND_COOLDOWN');
    }
    throw err;
  }

  return {
    verificationToken,
    nextResendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS),
  };
}
