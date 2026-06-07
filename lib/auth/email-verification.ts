import 'server-only';
import { AuditEventType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { recordAuditEventSafe } from '@/lib/audit/record';
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
const RESEND_COOLDOWN_UNIQUE_INDEXES = ['uk_email_verifications_active_per_user'] as const;

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
  // 신규 인증 성공 시 트랜잭션 밖에서 감사 emit하기 위해 verificationId를 캡처한다(멱등 재클릭은 미발행).
  let freshVerificationId: number | null = null;
  const result = await prisma.$transaction(async (tx) => {
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
      select: { id: true, userId: true },
    });
    // count=1이면 방금 UPDATE한 row가 반드시 존재 — non-null 단언 안전.
    if (row === null) {
      // 방어적 — 동일 트랜잭션 내 ghost row (이론상 불가). 일관성 위배.
      throw new AppError('SYS_INTERNAL_ERROR');
    }
    await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
    freshVerificationId = row.id;
    return { userId: row.userId, emailVerifiedAt: now, alreadyVerified: false };
  });

  // CANDID-026 Step 4 — EMAIL_VERIFIED 감사(신규 인증만). fail-open: 감사 실패가 인증을 막지 않음.
  // metadata는 PII-free(verificationId만). 토큰/이메일 평문은 절대 미기록(PR #33 H007).
  if (!result.alreadyVerified && freshVerificationId !== null) {
    await recordAuditEventSafe({
      eventType: AuditEventType.EMAIL_VERIFIED,
      actorUserId: result.userId,
      resourceType: 'user',
      resourceId: String(result.userId),
      metadata: { verificationId: freshVerificationId },
    });
  }

  return result;
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

  let newVerificationId: number;
  try {
    newVerificationId = await prisma.$transaction(async (tx) => {
      // 기존 미소진 토큰 전부 invalidate (보안 — 이전 토큰 즉시 무효).
      // ⚠️ 만료 토큰까지 포함해 consume해야 한다: 부분 유니크 인덱스
      //   uk_email_verifications_active_per_user (user_id) WHERE consumed_at IS NULL 는
      //   만료 여부와 무관하게 미소진 row를 1건으로 제한한다. cooldown 기준 `active`는
      //   만료 토큰을 제외(expiresAt > now)하므로, 만료된 미소진 토큰이 남아 있으면
      //   여기서 consume되지 않아 신규 create가 P2002로 실패한다(만료 토큰 영구 차단 버그).
      //   따라서 active.id 단건이 아니라 userId의 미소진 토큰 전부를 updateMany로 소진한다.
      await tx.emailVerification.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: now },
      });
      const created = await tx.emailVerification.create({
        data: { userId, tokenHash, expiresAt, lastSentAt: now },
        select: { id: true },
      });
      return created.id;
    });
  } catch (err) {
    // L-025 정밀 매핑 — `uk_email_verifications_active_per_user` 충돌만 cooldown 시맨틱.
    // `token_hash` UNIQUE 충돌(사실상 sha256 collision)은 시스템 에러로 전파.
    if (isUniqueViolationOn(err, RESEND_COOLDOWN_UNIQUE_INDEXES)) {
      throw new AppError('AUTH_VERIFICATION_RESEND_COOLDOWN');
    }
    throw err;
  }

  // CANDID-026 Step 4 — EMAIL_VERIFICATION_RESENT 감사. fail-open(재발송을 막지 않음).
  // metadata는 PII-free(verificationId만). 토큰/이메일 평문 미기록(PR #33 H007).
  await recordAuditEventSafe({
    eventType: AuditEventType.EMAIL_VERIFICATION_RESENT,
    actorUserId: userId,
    resourceType: 'user',
    resourceId: String(userId),
    metadata: { verificationId: newVerificationId },
  });

  return {
    verificationToken,
    nextResendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS),
  };
}

/**
 * 개발 전용 — 이메일 인증을 메일 링크 클릭 없이 즉시 완료 처리한다.
 *
 * 로컬은 메일 캐처(maildev)를 써 실제 수신함이 없으므로, 프로필에서 버튼 한 번으로
 * 인증을 끝낼 수 있게 하는 개발 편의 기능. 미소진 토큰을 전부 소진해 부분 유니크 슬롯도 정리한다.
 *
 * ⚠️ production에서는 절대 동작 금지 — 이메일 소유 증명 없이 self-verify가 가능해지면
 *    BR-AUTH-04(이메일 인증 게이트)를 우회한다. 라우트(404 차단) + 본 함수(throw) 이중 가드.
 */
export async function devVerifyEmailNow(
  userId: number,
): Promise<{ emailVerifiedAt: Date; alreadyVerified: boolean }> {
  if (getEnv().NODE_ENV === 'production') {
    // 운영 안전 가드 — 라우트가 먼저 차단하지만, 다른 호출 경로가 추가돼도 막히도록 방어.
    throw new AppError('AUTH_FORBIDDEN');
  }

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    if (user === null) {
      throw new AppError('USER_NOT_FOUND');
    }
    if (user.emailVerifiedAt !== null) {
      return { emailVerifiedAt: user.emailVerifiedAt, alreadyVerified: true };
    }
    // 미소진 토큰 전부 소진(부분 유니크 정리) + 인증 완료.
    await tx.emailVerification.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
    return { emailVerifiedAt: now, alreadyVerified: false };
  });

  // 신규 인증만 감사 emit. fail-open. dev 경로임을 metadata로 식별(PII-free).
  if (!result.alreadyVerified) {
    await recordAuditEventSafe({
      eventType: AuditEventType.EMAIL_VERIFIED,
      actorUserId: userId,
      resourceType: 'user',
      resourceId: String(userId),
      metadata: { dev: true },
    });
  }

  return result;
}
