import { NextResponse, type NextRequest } from 'next/server';
import { setAuthCookies } from '@/lib/auth/cookies';
import { AppError, withErrorHandler } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  verifyOAuthStateCookie,
  type OAuthProviderName,
} from '@/lib/auth/oauth/state';
import { getProvider, isOAuthProviderEnabled } from '@/lib/auth/oauth';
import { linkOrCreateOAuthUser } from '@/lib/auth/oauth/link';

// CANDID-012 Step 3 — GET /api/v1/auth/oauth/{provider}/callback.
//
// 흐름:
//   1) provider 화이트리스트 검증
//   2) provider error 응답 처리 (?error=access_denied) → /login으로 302
//   3) state 쿠키 검증 — 변조/만료/state 불일치/provider 불일치 모두 단일 코드로 차단
//   4) state 쿠키 즉시 소멸 (replay 차단)
//   5) provider.exchange — code → access_token → 프로필 조회
//   6) linkOrCreateOAuthUser — A/B/C 분기 트랜잭션
//   7) setAuthCookies(access/refresh) + 302 to sanitized redirect
//
// 보안:
//   - 모든 실패는 *발생 위치 무관* /login?error={코드}로 302 (브라우저 사용성 + 정보 누출 차단)
//   - state 쿠키 즉시 만료(maxAge=0) — 재사용 차단
//   - HTML 응답 미사용 (XSS 자료 차단)

const ALLOWED_PROVIDERS: ReadonlySet<OAuthProviderName> = new Set(['google', 'github']);

function loginRedirect(error: string): NextResponse {
  const url = new URL('/login', getEnv().NEXT_PUBLIC_APP_URL);
  url.searchParams.set('error', error);
  return NextResponse.redirect(url, { status: 302 });
}

function clearStateCookie(response: NextResponse): void {
  response.cookies.set(OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax',
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: 0,
  });
}

function callbackUrlFor(provider: OAuthProviderName): string {
  return `${getEnv().NEXT_PUBLIC_APP_URL}/api/v1/auth/oauth/${provider}/callback`;
}

export const GET = withErrorHandler(async (request: NextRequest, context: unknown) => {
  const ctx = context as { params: Promise<{ provider: string }> } | undefined;
  const params = ctx?.params ? await ctx.params : { provider: '' };
  const providerRaw = params.provider;

  if (!ALLOWED_PROVIDERS.has(providerRaw as OAuthProviderName)) {
    return new NextResponse(null, { status: 404 });
  }
  const provider = providerRaw as OAuthProviderName;

  if (!isOAuthProviderEnabled(provider)) {
    return new NextResponse(null, { status: 404 });
  }

  // (2) provider error 분기 — 사용자가 동의 화면에서 거부한 정상 종결.
  const providerError = request.nextUrl.searchParams.get('error');
  if (providerError !== null && providerError !== '') {
    const r = loginRedirect('oauth_user_denied');
    clearStateCookie(r);
    return r;
  }

  // (3-4) state 쿠키 검증 — 실패 시 단일 코드 수렴, 쿠키 즉시 소멸.
  const cookieValue = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null;
  const queryState = request.nextUrl.searchParams.get('state');
  let stateResult: ReturnType<typeof verifyOAuthStateCookie>;
  try {
    stateResult = verifyOAuthStateCookie(cookieValue, queryState, provider);
  } catch {
    const r = loginRedirect('oauth_state_invalid');
    clearStateCookie(r);
    return r;
  }

  const code = request.nextUrl.searchParams.get('code');
  if (typeof code !== 'string' || code === '') {
    const r = loginRedirect('oauth_state_invalid');
    clearStateCookie(r);
    return r;
  }

  // (5) token exchange + profile 조회
  let profile: Awaited<ReturnType<ReturnType<typeof getProvider>['exchange']>>;
  try {
    profile = await getProvider(provider).exchange({
      code,
      codeVerifier: stateResult.codeVerifier,
      redirectUri: callbackUrlFor(provider),
    });
  } catch {
    const r = loginRedirect('oauth_provider_error');
    clearStateCookie(r);
    return r;
  }

  // (6) link 트랜잭션
  let linkResult: Awaited<ReturnType<typeof linkOrCreateOAuthUser>>;
  try {
    linkResult = await linkOrCreateOAuthUser({
      provider,
      profile,
      options: {
        userAgent: request.headers.get('user-agent'),
        ipAddress: null,
      },
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'AUTH_OAUTH_EMAIL_TAKEN') {
      const r = loginRedirect('oauth_email_taken');
      clearStateCookie(r);
      return r;
    }
    if (err instanceof AppError && err.code === 'AUTH_INVALID_CREDENTIALS') {
      const r = loginRedirect('oauth_account_inactive');
      clearStateCookie(r);
      return r;
    }
    throw err;
  }

  // (7) JWT 쿠키 + 302 to sanitized redirect path
  const target = new URL(stateResult.redirect, getEnv().NEXT_PUBLIC_APP_URL);
  const response = NextResponse.redirect(target, { status: 302 });
  setAuthCookies(response, {
    access: { token: linkResult.tokens.accessToken, expiresAt: linkResult.tokens.accessExpiresAt },
    refresh: { token: linkResult.tokens.refreshToken, expiresAt: linkResult.tokens.refreshExpiresAt },
  });
  clearStateCookie(response);
  return response;
});
