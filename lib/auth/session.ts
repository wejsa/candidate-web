import 'server-only';
import { randomUUID } from 'node:crypto';
import type { RefreshToken } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { issueRefreshToken, verifyRefreshToken } from '@/lib/auth/jwt';
import { sha256Hex } from '@/lib/auth/token-hash';

// CANDID-006 Step 3 — RefreshToken DB 세션 레이어.
// jose 서명 토큰(jwt.ts)을 refresh_tokens 화이트리스트와 결합 — 서버측 즉시 무효화 가능.
// 토큰 원문은 저장하지 않고 sha256(token) hex(@db.Char(64))만 저장 — DB 유출 시에도 토큰 복원 불가.
// Node 전용 모듈 (node:crypto + Prisma) — Edge middleware는 import 금지 (계획서 R6).

/** revoked_reason 컬럼(@db.VarChar(50))에 기록하는 무효화 사유 — refresh_tokens 스키마 주석과 일치. */
export type RevokeReason =
  | 'rotated'
  | 'logout'
  | 'password_change'
  | 'reuse_detected'
  | 'user_withdrawn';

export type RefreshSessionError = 'invalid' | 'expired' | 'revoked' | 'not_found';

export interface RefreshSession {
  /** 서명된 refresh JWT 원문 — HttpOnly Cookie에 저장. DB에는 sha256 해시만 저장된다. */
  token: string;
  expiresAt: Date;
  /** 세션 소유자 — 호출측(refresh route)이 새 Access 토큰 발급에 사용. */
  userId: number;
  familyId: string;
  rotationCounter: number;
}

export interface IssueRefreshSessionOptions {
  /** 상태 유지 미체크 시 false → 1일 TTL. 기본 14일. */
  rememberMe?: boolean;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export type VerifyRefreshSessionResult =
  | { ok: true; session: RefreshToken }
  | { ok: false; reason: RefreshSessionError };

export type RotateRefreshSessionResult =
  | { ok: true; session: RefreshSession }
  | { ok: false; reason: RefreshSessionError };

// Step 2 fix(H005): sha256 SSOT 통일 — `lib/auth/token-hash.ts:sha256Hex` 사용으로 일원화.
// refresh_tokens.token_hash와 email_verifications.token_hash가 같은 헬퍼를 공유한다.

/**
 * 신규 refresh 세션 발급 — jose 토큰 발급 + refresh_tokens INSERT.
 * 새 로그인마다 새 familyId(rotation chain 시작점)를 생성한다.
 */
export async function issueRefreshSession(
  userId: number,
  options: IssueRefreshSessionOptions = {},
): Promise<RefreshSession> {
  const { token, expiresAt } = await issueRefreshToken(userId, {
    rememberMe: options.rememberMe,
  });
  const familyId = randomUUID();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      familyId,
      rotationCounter: 0,
      expiresAt,
      userAgent: options.userAgent ?? null,
      ipAddress: options.ipAddress ?? null,
    },
  });
  return { token, expiresAt, userId, familyId, rotationCounter: 0 };
}

/**
 * refresh 토큰의 서명·만료(jose) + DB 화이트리스트(존재·미revoke·미만료)를 모두 검증한다.
 * jwt.ts의 stateless verifyRefreshToken과 달리 "세션이 살아있음"까지 보장한다.
 */
export async function verifyRefreshSession(token: string): Promise<VerifyRefreshSessionResult> {
  const jwtResult = await verifyRefreshToken(token);
  if (!jwtResult.ok) {
    return { ok: false, reason: jwtResult.reason };
  }
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256Hex(token) },
  });
  if (row === null) {
    return { ok: false, reason: 'not_found' };
  }
  // 서명된 sub와 DB row의 소유자 불일치 — 정상 경로에서는 발생 불가, 데이터 정합성 방어.
  if (row.userId !== jwtResult.claims.userId) {
    return { ok: false, reason: 'invalid' };
  }
  if (row.revokedAt !== null) {
    return { ok: false, reason: 'revoked' };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, session: row };
}

/** rotate 트랜잭션 내부 신호 — 동시 회전 경쟁에서 패한 요청을 롤백시키기 위한 sentinel. */
class RotationConflictError extends Error {
  constructor() {
    super('refresh token rotation conflict — concurrent rotation already revoked the token');
    this.name = 'RotationConflictError';
  }
}

/**
 * refresh 토큰 회전 — 구 토큰 검증 후 revoke('rotated') + 신규 토큰 발급을 단일 트랜잭션으로 수행.
 * familyId는 승계되고 rotationCounter는 1 증가한다. 이미 revoke된 토큰은 'revoked'로 거부된다
 * (reuse detection 본격 로직은 CANDID-021 위임 — familyId/rotationCounter가 그 기반).
 *
 * 동시성(C001): 구 토큰 revoke를 `updateMany(where: revokedAt=null)` 조건부 갱신으로 수행하고
 * affected rows로 경쟁을 감지한다 — verify와 트랜잭션 사이 TOCTOU 윈도우에서 동일 토큰이
 * 동시에 회전돼도 정확히 하나만 성공하고 나머지는 'revoked'로 거부된다(한 family 활성 토큰 1개 보장).
 */
export async function rotateRefreshSession(oldToken: string): Promise<RotateRefreshSessionResult> {
  const verified = await verifyRefreshSession(oldToken);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const old = verified.session;
  const { token, expiresAt } = await issueRefreshToken(old.userId);
  const rotationCounter = old.rotationCounter + 1;
  try {
    await prisma.$transaction(async (tx) => {
      // 조건부 revoke — revokedAt이 아직 NULL인 row만 갱신. 다른 요청이 먼저 회전했다면
      // count=0 → RotationConflictError로 트랜잭션 롤백 → 신규 토큰 미발급.
      const revoked = await tx.refreshToken.updateMany({
        where: { id: old.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'rotated' },
      });
      if (revoked.count === 0) {
        throw new RotationConflictError();
      }
      await tx.refreshToken.create({
        data: {
          userId: old.userId,
          tokenHash: sha256Hex(token),
          familyId: old.familyId,
          rotationCounter,
          expiresAt,
          userAgent: old.userAgent,
          ipAddress: old.ipAddress,
        },
      });
    });
  } catch (err) {
    if (err instanceof RotationConflictError) {
      return { ok: false, reason: 'revoked' };
    }
    throw err;
  }
  return {
    ok: true,
    session: { token, expiresAt, userId: old.userId, familyId: old.familyId, rotationCounter },
  };
}

/**
 * 사용자의 모든 활성 refresh 세션을 일괄 revoke — BR-AUTH-05(비밀번호 변경 시 전체 무효화),
 * 로그아웃, 회원 탈퇴 등에서 호출. revoke된 세션 수를 반환한다.
 */
export async function revokeAllForUser(userId: number, reason: RevokeReason): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}
