import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readAuthCookies, setAuthCookies } from '@/lib/auth/cookies';
import { issueAccessToken } from '@/lib/auth/jwt';
import { authErrorResponse } from '@/lib/auth/middleware';
import { rotateRefreshSession } from '@/lib/auth/session';

// CANDID-006 Step 4 — POST /api/v1/auth/refresh
// Refresh Cookie 검증 → rotateRefreshSession(회전) → 새 Access + Refresh를 Set-Cookie로 발급.
// session.ts(Prisma + node:crypto)에 의존하므로 Node 런타임 강제 (Edge 배포 시 빌드 실패 방지).

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { refreshToken } = readAuthCookies(request);
  if (refreshToken === null) {
    return authErrorResponse(request, 401, 'AUTH_REFRESH_INVALID', 'Refresh 토큰이 없습니다.');
  }

  const rotated = await rotateRefreshSession(refreshToken);
  if (!rotated.ok) {
    const expired = rotated.reason === 'expired';
    return authErrorResponse(
      request,
      401,
      expired ? 'AUTH_REFRESH_EXPIRED' : 'AUTH_REFRESH_INVALID',
      expired
        ? 'Refresh 토큰이 만료되었습니다. 다시 로그인해 주세요.'
        : '유효하지 않은 Refresh 토큰입니다. 다시 로그인해 주세요.',
    );
  }

  const access = await issueAccessToken(rotated.session.userId);
  const response = NextResponse.json({ accessExpiresAt: access.expiresAt.toISOString() });
  setAuthCookies(response, { access, refresh: rotated.session });
  return response;
}
