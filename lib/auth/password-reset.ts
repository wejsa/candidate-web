import 'server-only';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { generateTokenHex, sha256Hex } from '@/lib/auth/token-hash';
import { hashPassword } from '@/lib/auth/password';
import { isUniqueViolationOn } from '@/lib/prisma/errors';

// CANDID-020 Step 2 — 비밀번호 재설정 요청 (US-AUTH-004).
//
// 계정 열거 방지 (핵심 보안 요구):
//   - 이메일 존재 여부·상태와 무관하게 라우터는 동일한 200 응답을 반환한다.
//   - 본 서비스는 *적격* 사용자(존재 + ACTIVE + passwordHash 보유)에게만 토큰을 발급하고
//     메일 인자를 반환한다. 비적격(미존재/LOCKED/WITHDRAWN/소셜전용/동시발급 race)은 null →
//     라우터는 메일을 보내지 않되 동일 응답을 유지한다.
//   - 미존재 이메일 조회를 WARN/감사로 남기지 않는다 (로그 사이드채널 차단).
//   - 메일 발송은 라우터에서 트랜잭션 외부 fire-and-forget (BR-TX-02) — 응답 타이밍 균일.
//
// 토큰: high-entropy random 32 bytes(평문 64-hex)를 메일 URL에 싣고, DB에는 sha256(token_hash)만
//       저장(CANDID-020 Step 1 마이그레이션). 30분 일회용.
//
// 동시 발급 race: `uk_password_reset_active_per_user` 부분 UNIQUE(consumed_at IS NULL)로 user당
//       활성 토큰 1건 강제. 정상 흐름은 "기존 활성 토큰 consume → 신규 INSERT" 순서라 충돌하지 않으나,
//       동시 두 요청이 겹치면 두 번째 INSERT가 P2002 → 조용히 null(중복 메일 회피). CANDID-036 패턴.

/** 재설정 토큰 유효기간 30분, 일회용 (US-AUTH-004). */
const RESET_TTL_MS = 30 * 60 * 1000;

/**
 * P2002 매핑 화이트리스트 — 활성 토큰 부분 UNIQUE 충돌만 "동시 발급 race"로 해석한다.
 * `password_reset_tokens_token_hash_key`(sha256 충돌)는 시스템 에러로 전파.
 */
const ACTIVE_PER_USER_UNIQUE_INDEXES = ['uk_password_reset_active_per_user'] as const;

export interface ResetRequestResult {
  /** 메일 수신 주소. */
  email: string;
  /** 사용자 이름 (메일 인사말). */
  name: string;
  /** 평문 재설정 토큰 — 메일 URL 인자. 응답/로그에는 절대 노출 금지. */
  resetToken: string;
}

/**
 * 비밀번호 재설정 요청 처리.
 *
 * @returns 적격 사용자에게 토큰을 발급한 경우 메일 인자, 그 외에는 `null`.
 *          호출측(라우터)은 반환값과 무관하게 동일한 성공 응답을 반환해야 한다(계정 열거 방지).
 */
export async function requestPasswordReset(
  email: string,
  now: Date = new Date(),
): Promise<ResetRequestResult | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, status: true, passwordHash: true },
  });

  // 적격성: 존재 + ACTIVE + 비밀번호 보유. 소셜 전용(passwordHash NULL)은 재설정 대상 아님.
  // 비적격 시 토큰 미발급 + null 반환 (라우터는 동일 200).
  if (user === null || user.status !== 'ACTIVE' || user.passwordHash === null) {
    return null;
  }

  const resetToken = generateTokenHex(32);
  const tokenHash = sha256Hex(resetToken);
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);

  try {
    await prisma.$transaction(async (tx) => {
      // 기존 활성 토큰 소진 → 부분 UNIQUE 슬롯 확보 후 신규 INSERT (CANDID-036 순서 규칙).
      // 이전 토큰을 즉시 무효화하여 메일 재요청 시 직전 링크가 살아있지 않도록 한다.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
    });
  } catch (err) {
    // 동시 발급 race — 다른 요청이 활성 토큰을 막 발급했다(uk_password_reset_active_per_user).
    // 중복 메일 회피를 위해 조용히 종료(라우터는 동일 200).
    // token_hash UNIQUE 충돌(sha256, 사실상 불가)은 시스템 에러로 전파.
    if (isUniqueViolationOn(err, ACTIVE_PER_USER_UNIQUE_INDEXES)) {
      return null;
    }
    throw err;
  }

  return { email: user.email, name: user.name, resetToken };
}

export interface ResetPasswordResult {
  userId: number;
  /** 무효화된 활성 refresh 세션 수 (BR-AUTH-05). */
  revokedSessions: number;
}

/**
 * 비밀번호 재설정 토큰을 소진하고 새 비밀번호로 변경한다 (US-AUTH-004, BR-AUTH-05).
 *
 * 흐름:
 *   1. bcrypt 해시는 **트랜잭션 외부**에서 계산 (~250ms — DB 커넥션 점유 회피, password.ts 주석).
 *   2. 단일 트랜잭션:
 *      a. race-free consume — `updateMany WHERE consumedAt=null AND expiresAt>now` (count=1 승자).
 *         email-verification.consumeVerificationToken과 동일한 직렬화 패턴 (CANDID-036).
 *      b. count=0 사후 분류: 부재 → INVALID(400), 이미 소진 → INVALID(400, 일회용), 만료 → EXPIRED(410).
 *      c. user.passwordHash 갱신.
 *      d. 해당 user의 모든 활성 refresh 토큰 일괄 revoke(`password_change`) — BR-AUTH-05.
 *         (revokeAllForUser와 동일 쿼리를 tx로 인라인 — 단일 트랜잭션 원자성 보장.)
 *
 * 동시 클릭 race: 두 요청이 같은 토큰을 소진해도 UPDATE row lock으로 첫 요청만 count=1,
 *   두 번째는 count=0 → 이미 소진(INVALID)로 분류. 비밀번호가 두 번 변경되지 않는다.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<ResetPasswordResult> {
  const tokenHash = sha256Hex(token);
  // bcrypt는 트랜잭션 외부 (DB 커넥션 점유 회피).
  const passwordHash = await hashPassword(newPassword);

  return prisma.$transaction(async (tx) => {
    // race-free 직렬화 — UPDATE row lock이 동시 두 요청 중 하나만 통과시킨다.
    const consumed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });

    if (consumed.count === 0) {
      // 사후 분류 — 부재 / 이미 소진(일회용 위반) / 만료
      const row = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { consumedAt: true },
      });
      if (row === null) {
        throw new AppError('AUTH_RESET_TOKEN_INVALID');
      }
      if (row.consumedAt !== null) {
        // 이미 사용된 토큰 재사용 — 일회용 위반.
        throw new AppError('AUTH_RESET_TOKEN_INVALID');
      }
      // consumedAt=null인데 count=0 → WHERE 불일치 사유는 expiresAt만 남음 (만료).
      throw new AppError('AUTH_RESET_TOKEN_EXPIRED');
    }

    // count=1 — 직렬화 승자. userId 조회.
    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (row === null) {
      // 방어적 — 동일 트랜잭션 내 ghost row (이론상 불가).
      throw new AppError('SYS_INTERNAL_ERROR');
    }

    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });

    // BR-AUTH-05 — 비밀번호 변경 시 모든 활성 refresh 세션 일괄 무효화 (단일 트랜잭션 내).
    const revoked = await tx.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'password_change' },
    });

    return { userId: row.userId, revokedSessions: revoked.count };
  });
}
