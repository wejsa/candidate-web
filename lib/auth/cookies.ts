import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import type { IssuedToken } from '@/lib/auth/jwt';

// CANDID-006 Step 2 — 인증 토큰 Cookie 입출력 헬퍼.
// 두 토큰 모두 HttpOnly + Secure(prod) + SameSite=Lax + Path=/ 로 통일:
//  - HttpOnly  : XSS로 인한 document.cookie 토큰 탈취 차단
//  - SameSite=Lax : cross-site POST CSRF 완화 (top-level GET 네비게이션은 허용)
//  - Secure    : 운영에서만 강제 — 로컬 http 개발 환경은 Cookie 미전송 방지 위해 제외

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

export interface AuthTokenPair {
  access: IssuedToken;
  refresh: IssuedToken;
}

export interface AuthCookieValues {
  accessToken: string | null;
  refreshToken: string | null;
}

function baseCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
} {
  return {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

/** Access + Refresh 토큰을 응답 Cookie에 기록. expires는 각 토큰의 만료 시각과 일치시킨다. */
export function setAuthCookies(response: NextResponse, tokens: AuthTokenPair): void {
  response.cookies.set(ACCESS_COOKIE, tokens.access.token, {
    ...baseCookieOptions(),
    expires: tokens.access.expiresAt,
  });
  response.cookies.set(REFRESH_COOKIE, tokens.refresh.token, {
    ...baseCookieOptions(),
    expires: tokens.refresh.expiresAt,
  });
}

/** 두 인증 Cookie를 즉시 만료(maxAge=0) — 로그아웃/세션 무효화 시 사용. */
export function clearAuthCookies(response: NextResponse): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    response.cookies.set(name, '', { ...baseCookieOptions(), maxAge: 0 });
  }
}

/** 요청 Cookie에서 두 토큰 값을 추출. 부재 시 null. */
export function readAuthCookies(request: NextRequest): AuthCookieValues {
  return {
    accessToken: request.cookies.get(ACCESS_COOKIE)?.value ?? null,
    refreshToken: request.cookies.get(REFRESH_COOKIE)?.value ?? null,
  };
}
