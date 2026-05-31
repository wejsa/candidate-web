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
 * 이미 'rotated'로 revoke된(=한 번 회전을 마친) 토큰이 다시 제시되면 rotation chain replay 공격으로 간주하고
 * 해당 family의 모든 활성 세션을 'reuse_detected'로 일괄 무효화한다(CANDID-021 Step 2 — OAuth RT reuse detection).
 * 정상 revoke 사유('logout'/'password_change'/'user_withdrawn')로 무효화된 토큰의 재제시는 단순 만료된 세션
 * 재사용이므로 family를 보존한다(공격 신호 아님). 자체 findUnique를 수행하므로 JWT가 이미 만료돼 verify가
 * DB를 보기 전에 단락된 경우(reason='expired')에도 DB의 revokedReason로 정확히 판정할 수 있다.
 */
async function detectRefreshReuse(token: string): Promise<void> {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (row !== null && row.revokedReason === 'rotated') {
    await revokeAllForFamily(row.familyId, 'reuse_detected');
  }
}

/**
 * refresh 토큰 회전 — 구 토큰 검증 후 revoke('rotated') + 신규 토큰 발급을 단일 트랜잭션으로 수행.
 * familyId는 승계되고 rotationCounter는 1 증가한다. 이미 revoke된/만료된 토큰은 거부되며,
 * 'rotated' 사유의 토큰 재제시는 reuse detection으로 family 전체를 무효화한다(detectRefreshReuse).
 *
 * 동시성(C001): 구 토큰 revoke를 `updateMany(where: revokedAt=null)` 조건부 갱신으로 수행하고
 * affected rows로 경쟁을 감지한다 — verify와 트랜잭션 사이 TOCTOU 윈도우에서 동일 토큰이
 * 동시에 회전돼도 정확히 하나만 성공하고 나머지는 'revoked'로 거부된다(한 family 활성 토큰 1개 보장).
 */
export async function rotateRefreshSession(oldToken: string): Promise<RotateRefreshSessionResult> {
  const verified = await verifyRefreshSession(oldToken);
  if (!verified.ok) {
    // chain replay reuse detection — JWT 만료 여부와 무관하게 DB의 revokedReason='rotated'가 SSOT다.
    // 'revoked'(미만료 JWT) + 'expired'(JWT TTL 경과)에서 모두 시도해야 지연 replay를 놓치지 않는다.
    // best-effort: family 무효화 실패(DB 장애)가 회전 거부 결정을 막지 않도록 throw를 삼킨다.
    if (verified.reason === 'revoked' || verified.reason === 'expired') {
      try {
        await detectRefreshReuse(oldToken);
      } catch (err) {
        console.error('[rotate] reuse detection failed (rotation still rejected):', err);
      }
    }
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
 * 단일 refresh 세션 revoke — 로그아웃(CANDID-021)에서 제시된 refresh 토큰 1건만 무효화한다.
 * 토큰 원문을 아는 주체(쿠키 보유자)만 호출 가능하므로 JWT 서명 재검증 없이 sha256 해시로 직접 조회한다.
 * 조건부 `updateMany(revokedAt=null)`로 **멱등** — 이미 revoke됐거나 존재하지 않으면 count 0 → false 반환(에러 아님).
 * (전체 디바이스 로그아웃이 필요하면 revokeAllForUser를 사용한다.)
 */
export async function revokeRefreshSession(token: string): Promise<boolean> {
  const result = await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256Hex(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'logout' },
  });
  return result.count > 0;
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

/**
 * 한 rotation family(familyId)의 모든 활성 세션을 일괄 revoke — reuse detection(detectRefreshReuse)에서
 * chain replay 감지 시 호출. 조건부 `updateMany(revokedAt=null)`로 이미 revoke된 row는 건드리지 않는다.
 */
export async function revokeAllForFamily(familyId: string, reason: RevokeReason): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

/**
 * 만료/오래된-revoke refresh 토큰 정리 — 야간 배치(CANDID-029)가 호출할 순수 도메인 함수.
 * 스케줄러 wiring은 본 함수 범위 밖이다(CANDID-029 위임). 삭제된 row 수를 반환한다.
 *
 * 보존 정책:
 *  - 미revoke 만료 토큰: 즉시 삭제(감사 가치 없음 — 정상 만료).
 *  - revoke 토큰: `graceDays`(기본 30일) 경과분만 삭제 — 그 전까지는 감사 추적(reuse_detected/logout 사유)을 위해 보존.
 *  활성(미revoke·미만료) 토큰과 grace 이내 revoke 토큰은 보존된다.
 */
export async function deleteExpiredRefreshTokens(
  now: Date = new Date(),
  graceDays = 30,
): Promise<number> {
  const graceCutoff = new Date(now.getTime() - graceDays * 24 * 3600 * 1000);
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ revokedAt: null, expiresAt: { lt: now } }, { revokedAt: { lt: graceCutoff } }],
    },
  });
  return result.count;
}
