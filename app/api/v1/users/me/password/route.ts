import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withErrorHandler } from '@/lib/errors';
import { USER_POLICIES, enforceUserRateLimit } from '@/lib/security/rate-limit';
import { PasswordChangeSchema } from '@/lib/users/schema';
import { changePassword } from '@/lib/users/password-change';

// CANDID-024 Step 3 — POST /api/v1/users/me/password (US-MY-004 비밀번호 변경, BR-AUTH-05).
//
// 보안 컨트롤:
//   1) 전역 middleware — HTTPS / CORS / CSRF Origin / 보안 헤더
//   2) requireAuth — 본인만
//   3) enforceUserRateLimit(PASSWORD_CHANGE_USER) — 5회/시간 (currentPassword brute-force 차단)
//   4) PasswordChangeSchema.parse — strict + 강도 검증 + new≠current
//   5) changePassword — 현재 비번 재확인 + 해싱 + (tx) 갱신·전체 revoke·감사 로그
//
// 응답: 204 No Content (토큰/PII 비공개). 전체 refresh 토큰이 revoke되므로 클라이언트는 재로그인 유도.
export const runtime = 'nodejs';

export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);

  const userRateLimit = enforceUserRateLimit(
    USER_POLICIES.PASSWORD_CHANGE_USER,
    ctx.userId,
    request,
  );
  if (userRateLimit.response !== null) return userRateLimit.response;

  const body = PasswordChangeSchema.parse(await request.json());
  await changePassword({
    userId: ctx.userId,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    userAgent: request.headers.get('user-agent'),
    ipAddress: null,
  });

  const response = new NextResponse(null, { status: 204 });
  userRateLimit.attachHeaders(response);
  return response;
});
