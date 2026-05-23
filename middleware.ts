import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { errorResponse, isAppError } from '@/lib/errors';
import { applySecurityHeaders } from '@/lib/security/headers';
import { applyCorsHeaders, buildPreflightResponse, getAllowedOrigins } from '@/lib/security/cors';
import { assertAllowedOrigin } from '@/lib/security/origin';

// CANDID-009 Step 1 — Edge runtime 진입점 (HTTPS 308 / CORS preflight / 보안 헤더).
// Step 2 추가: CSRF Origin 검증(state-changing methods) + H001 TRUST_PROXY + H003 Host 화이트리스트.
// Edge runtime 호환 — Node 모듈 의존 금지.

export function middleware(request: NextRequest): NextResponse {
  const env = getEnv();

  // 1) HTTPS 강제 — BR-SEC-01.
  if (env.FORCE_HTTPS_REDIRECT && !isSecureRequest(request, env.TRUST_PROXY)) {
    return buildHttpsRedirect(request);
  }

  // 2) CORS preflight — OPTIONS는 미들웨어에서 즉시 종결. Origin 검증보다 우선 (OPTIONS는 CSRF 비대상).
  if (request.method === 'OPTIONS') {
    return applySecurityHeaders(buildPreflightResponse(request));
  }

  // 3) CSRF Origin 검증 — Step 2(BR-SEC-02). state-changing methods 한정.
  //    assertAllowedOrigin이 AppError를 throw하면 표준 403 응답으로 변환.
  try {
    assertAllowedOrigin(request);
  } catch (err) {
    if (isAppError(err)) {
      return applySecurityHeaders(
        errorResponse(request, err.code, { message: err.message, details: err.details }),
      );
    }
    throw err;
  }

  // 4) 일반 요청: 다음 핸들러로 패스 + 응답 가공.
  const response = NextResponse.next();
  applySecurityHeaders(response);
  applyCorsHeaders(response, request.headers.get('origin'));
  return response;
}

/**
 * HTTPS 308 리다이렉트를 생성하되 nextUrl.host를 화이트리스트로 검증(H003 — open redirect 차단).
 * 공격자가 `Host: evil.com` 헤더를 위조하면 Next.js의 nextUrl.host가 그 값을 따른다 — 즉 redirect
 * Location이 https://evil.com/... 이 되어 피싱 유도 가능. nextUrl.host가 허용 origin set 외면 421.
 */
function buildHttpsRedirect(request: NextRequest): NextResponse {
  const requestedHost = request.nextUrl.host.toLowerCase();
  const allowedHosts = new Set<string>();
  for (const origin of getAllowedOrigins()) {
    try {
      allowedHosts.add(new URL(origin).host.toLowerCase());
    } catch {
      // origin set은 이미 정규화되어 있어 진입 가능성 낮음 — 방어 무시.
    }
  }
  if (requestedHost === '' || !allowedHosts.has(requestedHost)) {
    return applySecurityHeaders(new NextResponse(null, { status: 421 }));
  }
  const redirectUrl = new URL(request.nextUrl);
  redirectUrl.protocol = 'https:';
  return applySecurityHeaders(NextResponse.redirect(redirectUrl, 308));
}

/**
 * 요청이 HTTPS인지 판정.
 * H001 보강: X-Forwarded-Proto는 env.TRUST_PROXY=true일 때만 신뢰 — 직접 노출 환경에서
 * 클라이언트가 임의 헤더로 HTTPS 강제를 우회하는 공격 차단.
 */
function isSecureRequest(request: NextRequest, trustProxy: boolean): boolean {
  if (trustProxy) {
    const forwarded = request.headers.get('x-forwarded-proto');
    if (forwarded !== null && forwarded !== '') {
      const first = forwarded.split(',')[0]?.trim().toLowerCase() ?? '';
      return first === 'https';
    }
  }
  return request.nextUrl.protocol === 'https:';
}

// 정적 자원/Next 빌드 산출물/well-known은 미들웨어 패스 제외 (M005 보강 일부).
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml|\\.well-known/).*)',
  ],
};
