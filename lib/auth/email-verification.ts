import 'server-only';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { generateTokenHex, sha256Hex } from '@/lib/auth/token-hash';

// CANDID-010 Step 3 — 이메일 인증 토큰 검증 + 재발송.
// US-AUTH-001: 24h 토큰 + 60초 재발송 쿨다운. BR-AUTH-04: 미인증 사용자는 지원서 제출만 차단.
//
// CANDID-036 (Step 2) race fix — db-designer 권고 Option C 채택:
//   - consumeVerificationToken: `updateMany WHERE consumedAt=null AND expiresAt>now`로
//     PostgreSQL UPDATE row lock 자연 직렬화. `findUnique`+분기+`update` 사이 race window 제거.
//   - resendVerificationEmail: `uk_email_verifications_active_per_user` 부분 UNIQUE
//     (CANDID-036 Step 1 마이그레이션) 위반 시 P2002 → AUTH_VERIFICATION_RESEND_COOLDOWN 매핑.
//     쿨다운 검증이 트랜잭션 외부라 발생하는 TOCTOU race를 deep defense로 차단.

/** 인증 토큰 유효기간 24시간 (US-AUTH-001). */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** 재발송 쿨다운 60초 (US-AUTH-001). */
const RESEND_COOLDOWN_MS = 60 * 1000;
/** Prisma 부분 UNIQUE 위반 코드. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

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
 * 인증 메일 재발송 — 60초 쿨다운 + 기존 활성 토큰 invalidate + 신규 토큰 발행.
 *
 * CANDID-036 deep defense: 쿨다운 검증(트랜잭션 외부)에서 race 통과해도
 * `uk_email_verifications_active_per_user` 부분 UNIQUE 제약이 신규 INSERT를
 * P2002로 차단 → AUTH_VERIFICATION_RESEND_COOLDOWN으로 매핑 (race 의미 부합).
 */
export async function resendVerificationEmail(
  userId: number,
  now: Date = new Date(),
): Promise<ResendResult> {
  // 활성(미소진/미만료) 토큰 중 가장 최근 row 조회 — 쿨다운 기준점.
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
    // 부분 UNIQUE 위반 — race 시 (다른 트랜잭션이 먼저 신규 활성 토큰 생성) cooldown 시맨틱으로 매핑.
    if (isPrismaUniqueViolation(err)) {
      throw new AppError('AUTH_VERIFICATION_RESEND_COOLDOWN');
    }
    throw err;
  }

  return {
    verificationToken,
    nextResendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS),
  };
}

/** Prisma `PrismaClientKnownRequestError`의 P2002 식별 (instanceof 의존 제거). */
function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}
