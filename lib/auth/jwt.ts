import 'server-only';
import { errors, jwtVerify, SignJWT } from 'jose';
import { getEnv } from '@/lib/env';

// CANDID-006 Step 2 — JWT 발급/검증 코어 (jose HS512).
// jose는 Edge/Node 양쪽 호환 — middleware(Edge)와 Route Handler(Node)에서 공용 사용.
// Access/Refresh는 분리된 secret으로 서명(lib/env.ts refine가 동일 값 차단) +
// tokenType claim 검증으로 교차 사용 차단 — access 토큰을 refresh 자리에 제출하는 공격 방어.

const ISSUER = 'candidate-web';
const ALGORITHM = 'HS512';

export type TokenType = 'access' | 'refresh';

export interface AuthClaims {
  userId: number;
  tokenType: TokenType;
  jti: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/** verify 실패 사유 — 만료(client가 refresh 트리거)와 그 외(위조/형식 오류)를 호출측이 분기. */
export type TokenInvalidReason = 'expired' | 'invalid';

export type VerifyResult =
  | { ok: true; claims: AuthClaims }
  | { ok: false; reason: TokenInvalidReason };

export interface IssueRefreshOptions {
  /** 상태 유지(remember me) 체크 시 14일 TTL, 미체크(false) 시 1일 TTL. 기본 14일. */
  rememberMe?: boolean;
}

// secret은 매 발급/검증마다 동일 — 첫 사용 시 1회 인코딩 후 캐시.
let accessSecret: Uint8Array | undefined;
let refreshSecret: Uint8Array | undefined;

function getAccessSecret(): Uint8Array {
  if (accessSecret === undefined) {
    accessSecret = new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
  }
  return accessSecret;
}

function getRefreshSecret(): Uint8Array {
  if (refreshSecret === undefined) {
    refreshSecret = new TextEncoder().encode(getEnv().JWT_REFRESH_SECRET);
  }
  return refreshSecret;
}

async function signToken(
  userId: number,
  tokenType: TokenType,
  secret: Uint8Array,
  ttlSec: number,
): Promise<IssuedToken> {
  const issuedAtSec = Math.floor(Date.now() / 1000);
  const expiresAtSec = issuedAtSec + ttlSec;
  // jti — 동일 사용자·동일 초·동일 TTL로 발급해도 토큰이 고유하도록 보장
  // (session.ts가 sha256(token)을 UNIQUE 컬럼에 저장 — 충돌 fail-fast 회피).
  const token = await new SignJWT({ tokenType })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setIssuedAt(issuedAtSec)
    .setExpirationTime(expiresAtSec)
    .setJti(crypto.randomUUID())
    .sign(secret);
  return { token, expiresAt: new Date(expiresAtSec * 1000) };
}

export function issueAccessToken(userId: number): Promise<IssuedToken> {
  return signToken(userId, 'access', getAccessSecret(), getEnv().JWT_ACCESS_TTL_SEC);
}

export function issueRefreshToken(
  userId: number,
  options: IssueRefreshOptions = {},
): Promise<IssuedToken> {
  const env = getEnv();
  const ttlSec =
    options.rememberMe === false ? env.JWT_REFRESH_TTL_SHORT_SEC : env.JWT_REFRESH_TTL_SEC;
  return signToken(userId, 'refresh', getRefreshSecret(), ttlSec);
}

async function verifyToken(
  token: string,
  expectedType: TokenType,
  secret: Uint8Array,
): Promise<VerifyResult> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret, { algorithms: [ALGORITHM], issuer: ISSUER }));
  } catch (err) {
    // JWTExpired만 'expired' — 위조/형식 오류/issuer 불일치는 모두 'invalid'로 수렴.
    return { ok: false, reason: err instanceof errors.JWTExpired ? 'expired' : 'invalid' };
  }

  if (payload.tokenType !== expectedType) {
    return { ok: false, reason: 'invalid' };
  }
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof payload.jti !== 'string' || payload.iat === undefined || payload.exp === undefined) {
    return { ok: false, reason: 'invalid' };
  }
  return {
    ok: true,
    claims: {
      userId,
      tokenType: expectedType,
      jti: payload.jti,
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
    },
  };
}

export function verifyAccessToken(token: string): Promise<VerifyResult> {
  return verifyToken(token, 'access', getAccessSecret());
}

export function verifyRefreshToken(token: string): Promise<VerifyResult> {
  return verifyToken(token, 'refresh', getRefreshSecret());
}

/**
 * 테스트 전용 — secret 캐시 무효화 (aes-gcm.ts __resetCachedKeyForTesting 패턴).
 * secret 회전 또는 env 변경 테스트에서 사용. lib/env.ts의 __resetCachedEnvForTesting()도 함께 호출.
 * production에서 호출되면 throw — 운영 안전 가드.
 * @internal
 */
export function __resetCachedSecretsForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetCachedSecretsForTesting must not be called in production');
  }
  accessSecret = undefined;
  refreshSecret = undefined;
}
