import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clearAuthCookies, readAuthCookies } from '@/lib/auth/cookies';
import { revokeRefreshSession } from '@/lib/auth/session';
import { withErrorHandler } from '@/lib/errors';

// CANDID-021 — POST /api/v1/auth/logout
// 클라이언트 Access 제거(쿠키 클리어) + 서버 Refresh Token DB 블랙리스트(revokeRefreshSession).
// PRD US-AUTH-005: "Access Token은 클라이언트에서 제거, Refresh Token은 서버에서 블랙리스트 처리".
// 멱등: refresh 쿠키 부재/무효여도 항상 두 쿠키를 클리어하고 200을 반환한다
//       (세션 열거·CSRF 표면 최소화 — 토큰 존재 여부를 응답으로 구분하지 않는다).
// session.ts(Prisma + node:crypto)에 의존하므로 Node 런타임 강제 (Edge 배포 시 빌드 실패 방지).

export const runtime = 'nodejs';

export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { refreshToken } = readAuthCookies(request);
  if (refreshToken !== null) {
    // best-effort revoke — 결과와 무관하게 쿠키는 항상 클리어한다(멱등).
    await revokeRefreshSession(refreshToken);
  }
  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
});
