import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clearAuthCookies, readAuthCookies } from '@/lib/auth/cookies';
import { revokeRefreshSession } from '@/lib/auth/session';
import { withErrorHandler } from '@/lib/errors';

// CANDID-021 — POST /api/v1/auth/logout
// 클라이언트 Access 제거(쿠키 클리어) + 서버 Refresh Token DB 블랙리스트(revokeRefreshSession).
// PRD US-AUTH-005: "Access Token은 클라이언트에서 제거, Refresh Token은 서버에서 블랙리스트 처리".
// 멱등: refresh 쿠키 부재/무효/이미-revoke/DB 장애여도 항상 두 쿠키를 클리어하고 200을 반환한다
//       (세션 열거·CSRF 표면 최소화 — 토큰 존재 여부·revoke 성공 여부를 응답으로 구분하지 않는다).
// 주의: Access JWT는 stateless(30분)이므로 로그아웃은 쿠키 사본만 제거한다 — 이미 유출된 access
//       토큰은 만료까지 유효(즉시 무효화가 필요하면 access TTL 단축 + jti 블랙리스트는 후속 검토).
// session.ts(Prisma + node:crypto)에 의존하므로 Node 런타임 강제 (Edge 배포 시 빌드 실패 방지).

export const runtime = 'nodejs';

export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const { refreshToken } = readAuthCookies(request);
  if (refreshToken !== null) {
    // best-effort revoke — 서버측 revoke 실패가 클라이언트 쿠키 클리어(멱등 계약)를 막아선 안 된다.
    // revokeRefreshSession은 DB 장애 시 throw하므로 여기서 삼키고 항상 쿠키를 클리어한다.
    try {
      await revokeRefreshSession(refreshToken);
    } catch (err) {
      console.error('[logout] revokeRefreshSession failed (cookies still cleared):', err);
    }
  }
  const response = NextResponse.json({ ok: true });
  // 로그아웃 응답(토큰 클리어 Set-Cookie 포함)은 캐시/뒤로가기로 재사용되면 안 된다.
  response.headers.set('Cache-Control', 'no-store');
  clearAuthCookies(response);
  return response;
});
