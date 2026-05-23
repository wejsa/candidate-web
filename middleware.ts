import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { applySecurityHeaders } from '@/lib/security/headers';
import { applyCorsHeaders, buildPreflightResponse } from '@/lib/security/cors';

// CANDID-009 Step 1 — Next.js Edge runtime 진입점.
// 모든 요청에 (1) HTTPS 강제, (2) CORS preflight 처리, (3) 보안 헤더 부착을 적용한다.
// CSRF Origin 검증 / Rate Limit은 Step 2에서 통합. Edge runtime이므로 Node 모듈 의존 금지.

export function middleware(request: NextRequest): NextResponse {
  const env = getEnv();

  // 1) HTTPS 강제 — BR-SEC-01. X-Forwarded-Proto(프록시) 우선, 직접 노출 시 nextUrl.protocol.
  if (env.FORCE_HTTPS_REDIRECT && !isSecureRequest(request)) {
    const redirectUrl = new URL(request.nextUrl);
    redirectUrl.protocol = 'https:';
    const response = NextResponse.redirect(redirectUrl, 308);
    return applySecurityHeaders(response);
  }

  // 2) CORS preflight — 인증 우회 우려가 없는 OPTIONS는 미들웨어에서 즉시 종결.
  //    Route Handler까지 전달하지 않는다.
  if (request.method === 'OPTIONS') {
    return applySecurityHeaders(buildPreflightResponse(request));
  }

  // 3) 일반 요청: 다음 핸들러로 패스 + 응답 가공.
  const response = NextResponse.next();
  applySecurityHeaders(response);
  applyCorsHeaders(response, request.headers.get('origin'));
  return response;
}

function isSecureRequest(request: NextRequest): boolean {
  // 프록시/LB 뒤에서 동작 시 X-Forwarded-Proto 우선. 직접 노출 시 nextUrl.protocol.
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded !== null && forwarded !== '') {
    const first = forwarded.split(',')[0]?.trim().toLowerCase() ?? '';
    return first === 'https';
  }
  return request.nextUrl.protocol === 'https:';
}

// 정적 자원/Next 빌드 산출물은 미들웨어 패스 제외 — 매 요청 헤더 부착 비용 회피.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)'],
};
