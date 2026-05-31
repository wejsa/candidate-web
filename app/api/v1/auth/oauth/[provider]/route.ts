import { NextResponse, type NextRequest } from 'next/server';
import { withErrorHandler } from '@/lib/errors';
import { POLICIES, withRateLimit } from '@/lib/security/rate-limit';
import { getEnv } from '@/lib/env';
import {
  createOAuthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  OAUTH_STATE_TTL_MS,
  type OAuthProviderName,
} from '@/lib/auth/oauth/state';
import { getProvider, isOAuthProviderEnabled } from '@/lib/auth/oauth';
import { sanitizeOAuthRedirect } from '@/lib/auth/oauth/redirect';
import { getOptionalAuth } from '@/lib/auth/middleware';

// CANDID-012 Step 3 — GET /api/v1/auth/oauth/{provider} (start handler).
//
// 흐름:
//   1) provider 화이트리스트 (google|github) — 그 외 404
//   2) provider env 활성화 (CLIENT_ID/SECRET 양쪽 채워짐) — 미설정 404
//   3) redirect 쿼리 sanitize — `/`로 시작 + `//` 차단 (open-redirect 방지)
//   4) state/PKCE 생성 → 서명 쿠키 Set-Cookie + provider authorize URL 302
//
// 보안:
//   - withRateLimit(POLICIES.LOGIN) 재사용 — IP 10회/분 (BR-SEC-04)
//   - 쿠키 HttpOnly + Secure(prod) + SameSite=Lax + Path 한정
//   - state.ts가 5분 TTL HMAC 서명 부여

const ALLOWED_PROVIDERS: ReadonlySet<OAuthProviderName> = new Set(['google', 'github']);
const COOKIE_MAX_AGE_SEC = Math.floor(OAUTH_STATE_TTL_MS / 1000);

function callbackUrlFor(provider: OAuthProviderName): string {
  return `${getEnv().NEXT_PUBLIC_APP_URL}/api/v1/auth/oauth/${provider}/callback`;
}

export const GET = withErrorHandler(
  withRateLimit(POLICIES.LOGIN, async (request: NextRequest, context: unknown) => {
    // Next.js 15 dynamic route param 추출 — context.params는 Promise (App Router)
    const ctx = context as { params: Promise<{ provider: string }> } | undefined;
    const params = ctx?.params ? await ctx.params : { provider: '' };
    const providerRaw = params.provider;

    if (!ALLOWED_PROVIDERS.has(providerRaw as OAuthProviderName)) {
      // 화이트리스트 외 provider — 404 (정보 누출 차단, 가용/미가용 식별 불가능하게)
      return new NextResponse(null, { status: 404 });
    }
    const provider = providerRaw as OAuthProviderName;

    if (!isOAuthProviderEnabled(provider)) {
      // env 미설정 → 404 (활성/비활성 enumeration 차단)
      return new NextResponse(null, { status: 404 });
    }

    // CANDID-024 Step 5 — link-add 모드: 로그인 사용자가 본 provider를 자기 계정에 연결.
    // mode=link면 인증 필수(미인증 → /login 복귀), state에 서명된 linkUserId를 봉인해 callback이 연결로 분기.
    const isLinkMode = request.nextUrl.searchParams.get('mode') === 'link';
    let linkUserId: number | undefined;
    if (isLinkMode) {
      const auth = await getOptionalAuth(request);
      if (auth === null) {
        const loginUrl = new URL('/login', getEnv().NEXT_PUBLIC_APP_URL);
        loginUrl.searchParams.set('redirect', '/me/profile');
        return NextResponse.redirect(loginUrl, { status: 302 });
      }
      linkUserId = auth.userId;
    }

    // link 모드는 항상 마이페이지로 복귀. 일반 로그인은 호출자 redirect(sanitized).
    const redirect = isLinkMode
      ? '/me/profile'
      : sanitizeOAuthRedirect(request.nextUrl.searchParams.get('redirect'));
    const { state, codeChallenge, cookieValue, cookieExpires } = createOAuthState({
      provider,
      redirect,
      linkUserId,
    });

    const authorizeUrl = getProvider(provider).authorizeUrl({
      state,
      codeChallenge,
      redirectUri: callbackUrlFor(provider),
    });

    const response = NextResponse.redirect(authorizeUrl, { status: 302 });
    response.cookies.set(OAUTH_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      secure: getEnv().NODE_ENV === 'production',
      sameSite: 'lax',
      path: OAUTH_STATE_COOKIE_PATH,
      expires: cookieExpires,
      maxAge: COOKIE_MAX_AGE_SEC,
    });
    return response;
  }),
);
