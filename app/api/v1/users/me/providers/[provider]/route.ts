import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { unlinkProvider } from '@/lib/auth/oauth/unlink';
import { clientIpFromRequest } from '@/lib/security/rate-limit';
import type { OAuthProviderName } from '@/lib/auth/oauth/state';

// CANDID-024 Step 4 — DELETE /api/v1/users/me/providers/{provider} (US-MY-004 소셜 연결 해제).
//
// 보안 컨트롤:
//   1) 전역 middleware — HTTPS / CORS / CSRF Origin / 보안 헤더
//   2) requireAuth — 본인만 (토큰 userId로만 해제, IDOR 불가)
//   3) provider 화이트리스트 (google|github) — 그 외 404 (정보 누출 차단)
//   4) unlinkProvider — 행 잠금 + 마지막 인증수단 가드(USER_LAST_AUTH_METHOD) + 미연결 가드
//
// 응답: 204 No Content. prisma 사용 → Node 런타임.
export const runtime = 'nodejs';

const ALLOWED_PROVIDERS: ReadonlySet<OAuthProviderName> = new Set(['google', 'github']);

export const DELETE = withErrorHandler(
  withTraceContext(async (request: NextRequest, context: unknown) => {
    const auth = await requireAuth(request);

    const routeCtx = context as { params: Promise<{ provider: string }> } | undefined;
    const params = routeCtx?.params ? await routeCtx.params : { provider: '' };
    const providerRaw = params.provider;

    if (!ALLOWED_PROVIDERS.has(providerRaw as OAuthProviderName)) {
      // 화이트리스트 외 provider — 404 (가용/미가용 식별 불가능하게).
      return new NextResponse(null, { status: 404 });
    }

    await unlinkProvider({
      userId: auth.userId,
      provider: providerRaw as OAuthProviderName,
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIpFromRequest(request),
    });

    return new NextResponse(null, { status: 204 });
  }),
);
