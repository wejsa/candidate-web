import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readAuthCookies } from '@/lib/auth/cookies';
import { verifyAccessToken } from '@/lib/auth/jwt';

// CANDID-006 Step 4 — Route Handler 인증 헬퍼.
// requireAuth: 인증 필수 — 실패 시 401 NextResponse 반환 (호출측이 early-return).
// getOptionalAuth: 인증 선택 — 실패 시 null.
// jose verify만 사용 — DB 세션 대조(session.ts)는 호출하지 않아 Edge 호환 유지 (계획서 R6).

export interface AuthContext {
  userId: number;
}

/**
 * 표준 에러 응답 빌더 — CANDID-007 전역 에러 핸들러 도입 전까지의 최소 구현.
 * traceId/details는 추적 인프라(CANDID-026) 도입 후 보강한다.
 */
export function authErrorResponse(
  request: NextRequest,
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { timestamp: new Date().toISOString(), status, code, message, path: request.nextUrl.pathname },
    { status },
  );
}

/**
 * 인증 필수 — Access 토큰을 검증해 AuthContext를 반환하거나 401 응답을 반환한다.
 * 호출측: `const auth = await requireAuth(req); if (auth instanceof NextResponse) return auth;`
 * Access 만료는 AUTH_TOKEN_EXPIRED로 구분 — 클라이언트가 /auth/refresh 트리거를 분기할 수 있다.
 */
export async function requireAuth(request: NextRequest): Promise<AuthContext | NextResponse> {
  const { accessToken } = readAuthCookies(request);
  if (accessToken === null) {
    return authErrorResponse(request, 401, 'AUTH_TOKEN_INVALID', '인증 토큰이 없습니다.');
  }
  const result = await verifyAccessToken(accessToken);
  if (!result.ok) {
    return result.reason === 'expired'
      ? authErrorResponse(request, 401, 'AUTH_TOKEN_EXPIRED', 'Access 토큰이 만료되었습니다.')
      : authErrorResponse(request, 401, 'AUTH_TOKEN_INVALID', '유효하지 않은 인증 토큰입니다.');
  }
  return { userId: result.claims.userId };
}

/**
 * 인증 선택 — Access 토큰이 유효하면 AuthContext, 아니면 null.
 * 비로그인도 허용하는 엔드포인트(공고 조회 등)에서 사용.
 */
export async function getOptionalAuth(request: NextRequest): Promise<AuthContext | null> {
  const { accessToken } = readAuthCookies(request);
  if (accessToken === null) {
    return null;
  }
  const result = await verifyAccessToken(accessToken);
  return result.ok ? { userId: result.claims.userId } : null;
}
