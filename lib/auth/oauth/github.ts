import 'server-only';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { oauthFetchJson } from '@/lib/auth/oauth/http';
import type {
  AuthorizeUrlInput,
  ExchangeInput,
  OAuthProfile,
  OAuthProvider,
} from '@/lib/auth/oauth';

// CANDID-012 Step 2 — GitHub OAuth2 Authorization Code + PKCE (2022+ 지원).
//
// PRD US-AUTH-003: scope 'read:user user:email'. /user는 기본 프로필, /user/emails는
// primary+verified email 선택용 (GitHub는 /user 응답의 email 필드가 'private' 설정 시 null).
//
// 응답 차이:
//   - token endpoint: Accept: application/json 헤더 없이는 form-urlencoded 응답 (RFC 6749 비표준)
//   - User-Agent 헤더 권장 (GitHub API 정책)

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const USER_EMAILS_URL = 'https://api.github.com/user/emails';
const SCOPE = 'read:user user:email';
const USER_AGENT = 'candidate-web (CANDID-012)';

interface GithubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id?: number;
  login?: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

interface GithubEmailEntry {
  email?: string;
  primary?: boolean;
  verified?: boolean;
  visibility?: string | null;
}

export const githubOAuthProvider: OAuthProvider = {
  authorizeUrl({ state, codeChallenge, redirectUri }: AuthorizeUrlInput): string {
    const params = new URLSearchParams({
      client_id: getEnv().GITHUB_OAUTH_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      // GitHub는 response_type 명시 권장 (default 'code')
      response_type: 'code',
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // 매 로그인마다 동의 화면 강제 비활성 (allow_signup은 default true)
      allow_signup: 'true',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchange({ code, codeVerifier, redirectUri }: ExchangeInput): Promise<OAuthProfile> {
    const env = getEnv();
    if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) {
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code_verifier: codeVerifier,
    }).toString();

    const tokenJson = await oauthFetchJson<GithubTokenResponse>({
      method: 'POST',
      url: TOKEN_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // 명시 — 미설정 시 GitHub는 form-urlencoded로 응답해 JSON.parse 실패
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: tokenBody,
    });

    if (typeof tokenJson.access_token !== 'string' || tokenJson.access_token === '') {
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }

    const accessToken = tokenJson.access_token;

    const userResp = await oauthFetchJson<GithubUserResponse>({
      method: 'GET',
      url: USER_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
      },
    });

    if (typeof userResp.id !== 'number' || userResp.id <= 0) {
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }

    const emailsResp = await oauthFetchJson<GithubEmailEntry[]>({
      method: 'GET',
      url: USER_EMAILS_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!Array.isArray(emailsResp)) {
      throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
    }

    // primary+verified 우선 → 미존재 시 verified 첫 항목 → 미존재 시 null
    const primaryVerified = emailsResp.find(
      (e) => e.primary === true && e.verified === true && typeof e.email === 'string',
    );
    const verifiedAny = emailsResp.find(
      (e) => e.verified === true && typeof e.email === 'string',
    );
    const selectedEmail = primaryVerified?.email ?? verifiedAny?.email ?? null;
    const email = selectedEmail !== null ? selectedEmail.toLowerCase() : null;
    const emailVerified = email !== null;

    // 이름 fallback: /user.name → /user.login → email local-part → id
    const providerUserId = String(userResp.id);
    const name =
      typeof userResp.name === 'string' && userResp.name !== ''
        ? userResp.name
        : typeof userResp.login === 'string' && userResp.login !== ''
          ? userResp.login
          : (email?.split('@')[0] ?? providerUserId);

    const profileImageUrl =
      typeof userResp.avatar_url === 'string' && userResp.avatar_url !== ''
        ? userResp.avatar_url
        : null;

    return {
      providerUserId,
      email,
      emailVerified,
      name,
      profileImageUrl,
    };
  },
};
