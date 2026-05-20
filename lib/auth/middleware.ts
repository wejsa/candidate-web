import type { NextRequest } from 'next/server';
import { readAuthCookies } from '@/lib/auth/cookies';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { AppError } from '@/lib/errors';

// CANDID-006 Step 4 / CANDID-007 Step 3 — Route Handler 인증 헬퍼.
// requireAuth: 인증 필수 — 실패 시 AppError를 throw한다 (withErrorHandler가 표준 에러 응답으로 변환).
// getOptionalAuth: 인증 선택 — 실패 시 null.
// jose verify만 사용 — DB 세션 대조(session.ts)는 호출하지 않아 Edge 호환 유지 (계획서 R6).

export interface AuthContext {
  userId: number;
}

/**
 * 인증 필수 — Access 토큰을 검증해 AuthContext를 반환하거나 AppError를 throw한다.
 * 호출측은 Route Handler를 withErrorHandler로 감싸 throw된 AppError가 표준 응답으로 변환되게 한다.
 * Access 만료는 AUTH_TOKEN_EXPIRED로 구분 — 클라이언트가 /auth/refresh 트리거를 분기할 수 있다.
 */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const { accessToken } = readAuthCookies(request);
  if (accessToken === null) {
    throw new AppError('AUTH_TOKEN_INVALID', { message: '인증 토큰이 없습니다.' });
  }
  const result = await verifyAccessToken(accessToken);
  if (!result.ok) {
    throw new AppError(result.reason === 'expired' ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID');
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
