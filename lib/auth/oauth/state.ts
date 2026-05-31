import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';

// CANDID-012 Step 1 — OAuth2 state + PKCE 단기 보존 (US-AUTH-003, BR-AUTH-06).
//
// 외부 OAuth provider(Google/GitHub)로 302 redirect 직전 생성되는 일회용 보안 토큰 일체를
// 서명된 쿠키에 캡슐화한다. 후속 callback이 동일 요청 흐름에서 발생했음을 검증한다.
//
// 구성 요소:
//   - state: 32바이트 무작위 hex(64자) — CSRF 차단. authorize URL과 콜백에 모두 전달되고,
//            쿠키에 저장된 값과 timing-safe 비교한다.
//   - codeVerifier: 32바이트 무작위 base64url(43자) — PKCE (RFC 7636) 비밀.
//                   exchange 단계에서만 사용. 쿠키에만 저장하고 외부에는 노출하지 않는다.
//   - codeChallenge: SHA256(codeVerifier) base64url — authorize URL에 전달.
//   - provider: 'google' | 'github' — 쿠키에 함께 캡슐화해 콜백 경로 위조 차단.
//   - redirect: 로그인 성공 후 복귀 경로 — 호출자가 sanitize한 값을 받아 그대로 보관.
//
// 쿠키 포맷: base64url(JSON payload) + "." + base64url(HMAC-SHA256 서명)
//   payload = { provider, redirect, codeVerifier, state, nonce, exp(ms epoch) }
//   서명 키: JWT_ACCESS_SECRET → SHA256으로 32바이트 derivation (별도 HMAC 키 도입을 피해
//          기존 secret을 재사용. namespace 분리를 위해 키 도출 단계에 'oauth-state' 라벨 적용)
//
// TTL: 5분 — 사용자가 로그인 페이지로 진입 후 provider 동의 화면을 거쳐 callback까지 도달하는
//      현실적 상한. 시스템 시계 오차 방지를 위해 만료 비교는 ms 단위로 수행.

/** OAuth state·PKCE 쿠키 TTL (ms). Set-Cookie Max-Age 산출의 SSOT — Step 2/3 라우터에서 동일 값 사용. */
export const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const SIGNING_LABEL = 'oauth-state';

/** state(쿼리/쿠키 동시) — 32바이트 무작위 hex 64자. */
const STATE_BYTES = 32;
/** PKCE codeVerifier — RFC 7636 §4.1: 43~128자 unreserved. 32바이트 base64url=43자. */
const VERIFIER_BYTES = 32;
/** payload 재생 차단용 nonce — 만료 전 동일 쿠키 재사용을 막지는 못하지만 서명 namespace 충돌을 막는다. */
const NONCE_BYTES = 16;

export type OAuthProviderName = 'google' | 'github';

export const OAUTH_STATE_COOKIE = 'oauth_state';
/** 콜백 라우터 prefix — 본 쿠키는 OAuth 라우트 외부로 새지 않아야 한다. */
export const OAUTH_STATE_COOKIE_PATH = '/api/v1/auth/oauth';

export interface CreateOAuthStateInput {
  provider: OAuthProviderName;
  redirect: string;
  /**
   * CANDID-024 Step 5 — link-add 의도. 설정 시 callback이 새 로그인이 아니라
   * 이 userId에 provider를 *연결*한다. 서명 페이로드에 포함되어 위조 불가.
   */
  linkUserId?: number;
}

export interface CreateOAuthStateResult {
  /** authorize URL의 `state` 파라미터 — 쿼리에 평문 노출, 콜백에서 쿠키 페이로드와 비교. */
  state: string;
  /** PKCE 비밀 — 외부 노출 금지. callback의 exchange 단계에서만 사용. */
  codeVerifier: string;
  /** authorize URL의 `code_challenge` (S256). */
  codeChallenge: string;
  /** Set-Cookie value — 쿠키 옵션은 호출자가 결정 (HttpOnly/SameSite/Secure 등). */
  cookieValue: string;
  /** Set-Cookie의 expires — TTL과 일치. */
  cookieExpires: Date;
}

export interface VerifyOAuthStateResult {
  provider: OAuthProviderName;
  redirect: string;
  codeVerifier: string;
  /** CANDID-024 Step 5 — link-add 대상 userId (서명 검증된 값). 일반 로그인 흐름이면 undefined. */
  linkUserId?: number;
}

interface StatePayload {
  /** 'google' | 'github'. */
  p: OAuthProviderName;
  /** redirect path. */
  r: string;
  /** codeVerifier. */
  v: string;
  /** state. */
  s: string;
  /** nonce hex (16바이트). */
  n: string;
  /** 만료 epoch ms. */
  e: number;
  /** CANDID-024 Step 5 — link-add 대상 userId (선택). 부재 시 일반 로그인. */
  u?: number;
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** JWT_ACCESS_SECRET → 32바이트 HMAC 키 도출 ('oauth-state' namespace로 다른 용도와 격리). */
function getSigningKey(): Buffer {
  const secret = getEnv().JWT_ACCESS_SECRET;
  return createHash('sha256').update(`${SIGNING_LABEL}:${secret}`).digest();
}

function sign(payloadB64: string): string {
  return base64urlEncode(createHmac('sha256', getSigningKey()).update(payloadB64).digest());
}

/**
 * OAuth start 핸들러에서 호출 — state·PKCE 쌍을 생성하고 쿠키 값을 직렬화한다.
 * 반환된 `cookieValue`는 HttpOnly + Secure(prod) + SameSite=Lax + Path=/api/v1/auth/oauth로 설정한다.
 */
export function createOAuthState(input: CreateOAuthStateInput): CreateOAuthStateResult {
  const state = randomBytes(STATE_BYTES).toString('hex');
  const codeVerifier = base64urlEncode(randomBytes(VERIFIER_BYTES));
  const codeChallenge = base64urlEncode(createHash('sha256').update(codeVerifier).digest());
  const nonce = randomBytes(NONCE_BYTES).toString('hex');
  const now = Date.now();
  const expiresAtMs = now + OAUTH_STATE_TTL_MS;

  const payload: StatePayload = {
    p: input.provider,
    r: input.redirect,
    v: codeVerifier,
    s: state,
    n: nonce,
    e: expiresAtMs,
  };
  if (input.linkUserId !== undefined) {
    payload.u = input.linkUserId;
  }

  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = sign(payloadB64);
  const cookieValue = `${payloadB64}.${signature}`;

  return {
    state,
    codeVerifier,
    codeChallenge,
    cookieValue,
    cookieExpires: new Date(expiresAtMs),
  };
}

/**
 * OAuth callback 핸들러에서 호출 — 쿠키 값을 검증하고 페이로드를 반환한다.
 * 모든 실패 경로는 동일한 `AUTH_OAUTH_STATE_INVALID`로 throw (변조/만료/불일치 구분 비노출).
 *
 * 검증 단계:
 *   1) 구조: `payload.signature` 형식, base64url 디코딩 가능
 *   2) 서명: HMAC-SHA256 timing-safe equal
 *   3) 만료: payload.exp > now
 *   4) state 일치: 쿼리 state == payload.state (timing-safe)
 *   5) provider 일치: URL [provider] == payload.provider
 *
 * @throws AppError(AUTH_OAUTH_STATE_INVALID)
 */
export function verifyOAuthStateCookie(
  cookieValue: string | null | undefined,
  queryState: string | null | undefined,
  urlProvider: string,
): VerifyOAuthStateResult {
  if (typeof cookieValue !== 'string' || cookieValue === '') {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }
  if (typeof queryState !== 'string' || queryState === '') {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }

  const parts = cookieValue.split('.');
  if (parts.length !== 2) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }
  const payloadB64 = parts[0];
  const signatureB64 = parts[1];
  if (typeof payloadB64 !== 'string' || typeof signatureB64 !== 'string') {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }

  // 서명 검증 (timing-safe)
  const expectedSig = sign(payloadB64);
  if (expectedSig.length !== signatureB64.length) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }
  if (!timingSafeEqual(Buffer.from(expectedSig, 'utf8'), Buffer.from(signatureB64, 'utf8'))) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }

  // 페이로드 파싱
  let payload: StatePayload;
  try {
    const decoded = base64urlDecode(payloadB64).toString('utf8');
    payload = JSON.parse(decoded) as StatePayload;
  } catch {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload.p !== 'google' && payload.p !== 'github') ||
    typeof payload.r !== 'string' ||
    typeof payload.v !== 'string' ||
    typeof payload.s !== 'string' ||
    typeof payload.n !== 'string' ||
    typeof payload.e !== 'number' ||
    (payload.u !== undefined && (typeof payload.u !== 'number' || !Number.isInteger(payload.u)))
  ) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }

  if (Date.now() >= payload.e) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }

  if (payload.s.length !== queryState.length) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }
  if (!timingSafeEqual(Buffer.from(payload.s, 'utf8'), Buffer.from(queryState, 'utf8'))) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }

  if (payload.p !== urlProvider) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID');
  }

  return {
    provider: payload.p,
    redirect: payload.r,
    codeVerifier: payload.v,
    linkUserId: payload.u,
  };
}
