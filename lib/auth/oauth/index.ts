import 'server-only';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { googleOAuthProvider } from '@/lib/auth/oauth/google';
import { githubOAuthProvider } from '@/lib/auth/oauth/github';
import type { OAuthProviderName } from '@/lib/auth/oauth/state';

// CANDID-012 Step 2 — OAuth Provider 추상화 (US-AUTH-003).
//
// Google/GitHub 두 provider의 차이를 흡수해 callback 라우터가 동일 인터페이스로 호출하도록 한다.
// Authorization Code Flow + PKCE (RFC 7636) 패턴은 공통이며 각 구현은 다음 차이만 처리:
//   - authorize URL host/path
//   - scope 문자열 (Google: 'openid profile email' / GitHub: 'read:user user:email')
//   - token exchange endpoint + Accept 헤더
//   - profile 조회 (Google: userinfo 1회 / GitHub: /user + /user/emails 2회)
//
// 외부 OAuth access_token/refresh_token은 *반환만* 하고 저장하지 않는다 (자체 JWT만 발급).
// SSRF 방어: 모든 endpoint hard-coded, 사용자 입력 미반영. fetch는 5초 timeout + 1MB 응답 cap.

export type { OAuthProviderName };

/**
 * Provider에서 정규화된 사용자 프로필.
 * Step 3 linkOrCreateOAuthUser가 이 형태로 User/AuthProvider를 매핑한다.
 */
export interface OAuthProfile {
  /** provider 내부 사용자 ID (Google sub / GitHub id). AuthProvider.providerUserId 컬럼에 저장. */
  providerUserId: string;
  /** 정규화 lowercase email — provider가 미제공 시 null (GitHub primary email private 등). */
  email: string | null;
  /** provider가 email 인증 완료를 보증하면 true. User.emailVerifiedAt 설정 여부에 사용. */
  emailVerified: boolean;
  /** 표시 이름 — provider 부재 시 email local-part 또는 providerUserId fallback. */
  name: string;
  /** AuthProvider.profileImageUrl에 저장. 미제공 시 null. */
  profileImageUrl: string | null;
}

export interface AuthorizeUrlInput {
  /** Step 1 createOAuthState에서 발급된 state 64자 hex. */
  state: string;
  /** PKCE S256 challenge — Step 1 createOAuthState 결과. */
  codeChallenge: string;
  /** OAuth callback URL — provider에 등록된 redirect_uri와 정확히 일치해야 한다. */
  redirectUri: string;
}

export interface ExchangeInput {
  /** provider callback에서 받은 authorization code. */
  code: string;
  /** Step 1 createOAuthState에서 발급된 PKCE verifier. */
  codeVerifier: string;
  /** authorize 단계와 동일한 redirect_uri (provider 검증 통과 조건). */
  redirectUri: string;
}

export interface OAuthProvider {
  /** authorize 단계의 URL 생성 (302 redirect 대상). */
  authorizeUrl(input: AuthorizeUrlInput): string;
  /** code → access_token 교환 + 프로필 조회. 실패 시 AppError(AUTH_OAUTH_PROVIDER_ERROR). */
  exchange(input: ExchangeInput): Promise<OAuthProfile>;
}

/**
 * Provider 화이트리스트 → 구현 라우팅.
 * 화이트리스트 외 입력은 caller에서 verifyOAuthStateCookie가 차단하지만 defense-in-depth로 한 번 더 검사.
 *
 * @throws AppError(AUTH_OAUTH_PROVIDER_ERROR) provider env 미설정 (CLIENT_ID/SECRET 누락)
 */
export function getProvider(name: OAuthProviderName): OAuthProvider {
  if (name === 'google') {
    if (!isOAuthProviderEnabled('google')) {
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }
    return googleOAuthProvider;
  }
  if (name === 'github') {
    if (!isOAuthProviderEnabled('github')) {
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }
    return githubOAuthProvider;
  }
  // exhaustive guard — 컴파일 타임에 차단되지만 런타임 fail-safe.
  throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
}

/**
 * provider env 활성화 여부 — Step 3 라우터가 404 분기에 사용.
 * env.superRefine으로 쌍 무결성이 보장되어 두 변수 모두 채워지거나 모두 비워진 두 상태만 가능.
 */
export function isOAuthProviderEnabled(name: OAuthProviderName): boolean {
  const env = getEnv();
  if (name === 'google') {
    return !!env.GOOGLE_OAUTH_CLIENT_ID && !!env.GOOGLE_OAUTH_CLIENT_SECRET;
  }
  return !!env.GITHUB_OAUTH_CLIENT_ID && !!env.GITHUB_OAUTH_CLIENT_SECRET;
}
