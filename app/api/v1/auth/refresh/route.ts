import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readAuthCookies, setAuthCookies } from '@/lib/auth/cookies';
import { issueAccessToken } from '@/lib/auth/jwt';
import { rotateRefreshSession } from '@/lib/auth/session';
import { AppError, withErrorHandler } from '@/lib/errors';

// CANDID-006 Step 4 / CANDID-007 Step 3 — POST /api/v1/auth/refresh
// Refresh Cookie 검증 → rotateRefreshSession(회전) → 새 Access + Refresh를 Set-Cookie로 발급.
// withErrorHandler로 감싸 throw된 AppError를 표준 에러 응답으로 변환한다.
// session.ts(Prisma + node:crypto)에 의존하므로 Node 런타임 강제 (Edge 배포 시 빌드 실패 방지).

export const runtime = 'nodejs';

export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { refreshToken } = readAuthCookies(request);
  if (refreshToken === null) {
    throw new AppError('AUTH_REFRESH_INVALID', { message: 'Refresh 토큰이 없습니다.' });
  }

  const rotated = await rotateRefreshSession(refreshToken);
  if (!rotated.ok) {
    throw new AppError(
      rotated.reason === 'expired' ? 'AUTH_REFRESH_EXPIRED' : 'AUTH_REFRESH_INVALID',
    );
  }

  const access = await issueAccessToken(rotated.session.userId);
  const response = NextResponse.json({ accessExpiresAt: access.expiresAt.toISOString() });
  setAuthCookies(response, { access, refresh: rotated.session });
  return response;
});
