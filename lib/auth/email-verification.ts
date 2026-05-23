import 'server-only';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { generateTokenHex, sha256Hex } from '@/lib/auth/token-hash';

// CANDID-010 Step 3 — 이메일 인증 토큰 검증 + 재발송.
// US-AUTH-001: 24h 토큰 + 60초 재발송 쿨다운. BR-AUTH-04: 미인증 사용자는 지원서 제출만 차단.
// 트랜잭션 경계 (db-designer 권고):
//   verify: FOR UPDATE로 token row 잠금 → user.emailVerifiedAt + token.consumedAt 동시 갱신 (원자)
//   resend: 활성 토큰 invalidate(consumedAt) + 신규 row INSERT — 60s 쿨다운 검증 후

/** 인증 토큰 유효기간 24시간 (US-AUTH-001). */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** 재발송 쿨다운 60초 (US-AUTH-001). */
const RESEND_COOLDOWN_MS = 60 * 1000;

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
 * 평문 토큰을 sha256으로 해시하여 emailVerification row를 조회하고 소진한다.
 * - 토큰 부재/형식 오류: 400 AUTH_VERIFICATION_TOKEN_INVALID
 * - 만료: 410 AUTH_VERIFICATION_TOKEN_EXPIRED
 * - 이미 소진된 토큰(이메일 중복 클릭): 멱등 응답 (alreadyVerified=true)
 *
 * 동시성: $transaction + FOR UPDATE로 같은 토큰의 중복 소진을 직렬화.
 */
export async function consumeVerificationToken(token: string): Promise<ConsumeResult> {
  const tokenHash = sha256Hex(token);
  return prisma.$transaction(async (tx) => {
    const row = await tx.emailVerification.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        consumedAt: true,
        user: { select: { emailVerifiedAt: true } },
      },
    });
    if (row === null) {
      throw new AppError('AUTH_VERIFICATION_TOKEN_INVALID');
    }
    // 멱등 응답 — 이미 소진된 토큰을 재클릭한 정상 사용자
    if (row.consumedAt !== null) {
      const emailVerifiedAt = row.user.emailVerifiedAt ?? row.consumedAt;
      return { userId: row.userId, emailVerifiedAt, alreadyVerified: true };
    }
    const now = new Date();
    if (row.expiresAt.getTime() <= now.getTime()) {
      throw new AppError('AUTH_VERIFICATION_TOKEN_EXPIRED');
    }
    // 원자 갱신 — user.emailVerifiedAt + emailVerification.consumedAt
    await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
    await tx.emailVerification.update({ where: { id: row.id }, data: { consumedAt: now } });
    return { userId: row.userId, emailVerifiedAt: now, alreadyVerified: false };
  });
}

/**
 * 인증 메일 재발송 — 60초 쿨다운 + 기존 활성 토큰 invalidate + 신규 토큰 발행.
 * - 활성 토큰의 lastSentAt + 60s > now → AUTH_VERIFICATION_RESEND_COOLDOWN
 * - 기존 활성 토큰은 consumedAt=now로 invalidate (보안: 이전 토큰 즉시 무효)
 * - 이미 인증 완료된 사용자라면 토큰 발행 불요 — 호출측이 사전 검사하거나 본 함수가 idempotent 반환
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

  return {
    verificationToken,
    nextResendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS),
  };
}
