import 'server-only';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { oauthFetchJson } from '@/lib/auth/oauth/http';
import { normalizeOAuthName, safeHttpsUrl } from '@/lib/auth/oauth/normalize';
import type {
  AuthorizeUrlInput,
  ExchangeInput,
  OAuthProfile,
  OAuthProvider,
} from '@/lib/auth/oauth';

// CANDID-012 Step 2 — Google OAuth2 Authorization Code + PKCE.
//
// PRD US-AUTH-003: scope 'profile email'. OpenID Connect의 'openid'를 추가해 userinfo endpoint
// 접근권을 명시한다. 'openid profile email' 3 scope만 요청 (최소 수집 원칙, BR-PII-04).
//
// id_token 검증은 본 Step에서 도입하지 않는다:
//   - userinfo endpoint가 동일 정보를 제공
//   - id_token 검증은 jose JWS verify + JWK 캐시 + iss/aud/exp 검사를 요구해 비용 큼
//   - Step 3 후속 보강 시 도입 가능 (OWASP CSRF 시나리오는 PKCE + state로 이미 차단)
//
// 외부 OAuth token은 자체 JWT 발급 후 폐기 — providerAccessToken 반환 없음.

/** Google authorize endpoint — provider hard-coded (사용자 입력 미반영, SSRF 차단). */
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Google token exchange endpoint. */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Google userinfo endpoint (OpenID Connect). */
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
/** 최소 scope — PRD §US-AUTH-003. */
const SCOPE = 'openid profile email';

interface GoogleTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
}

interface GoogleUserinfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

export const googleOAuthProvider: OAuthProvider = {
  authorizeUrl({ state, codeChallenge, redirectUri }: AuthorizeUrlInput): string {
    const params = new URLSearchParams({
      client_id: getEnv().GOOGLE_OAUTH_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // 동의 화면을 매번 표시할지 — 신규 사용자 검증 흐름이므로 'consent' 대신 default 'select_account'.
      // 동일 Google 계정으로 반복 로그인 시 동의 화면 생략 (UX).
      access_type: 'online',
      prompt: 'select_account',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchange({ code, codeVerifier, redirectUri }: ExchangeInput): Promise<OAuthProfile> {
    const env = getEnv();
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
      // index.ts의 getProvider가 isOAuthProviderEnabled로 한 번 더 검증하지만 defense-in-depth.
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code_verifier: codeVerifier,
    }).toString();

    const tokenJson = await oauthFetchJson<GoogleTokenResponse>({
      method: 'POST',
      url: TOKEN_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenBody,
    });

    if (typeof tokenJson.access_token !== 'string' || tokenJson.access_token === '') {
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }

    const userinfo = await oauthFetchJson<GoogleUserinfoResponse>({
      method: 'GET',
      url: USERINFO_URL,
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/json',
      },
    });

    if (typeof userinfo.sub !== 'string' || userinfo.sub === '') {
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }

    const email =
      typeof userinfo.email === 'string' && userinfo.email !== ''
        ? userinfo.email.trim().toLowerCase()
        : null;
    const emailVerified = email !== null && userinfo.email_verified === true;
    // review fix (D-MAJOR-2/1): provider 내부 ID 노출 회피 — name fallback에서 sub 제외.
    // 모든 후보 실패 시 normalizeOAuthName이 '소셜 사용자' 반환.
    const name = normalizeOAuthName(userinfo.name, email?.split('@')[0]);
    // review fix (D-MAJOR-3): https 스킴만 허용 (javascript:/data:/http: 차단).
    const profileImageUrl = safeHttpsUrl(userinfo.picture);

    return {
      providerUserId: userinfo.sub,
      email,
      emailVerified,
      name,
      profileImageUrl,
    };
  },
};
