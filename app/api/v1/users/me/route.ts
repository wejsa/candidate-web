import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withErrorHandler } from '@/lib/errors';
import { USER_POLICIES, enforceUserRateLimit } from '@/lib/security/rate-limit';
import { getProfile, updateProfile } from '@/lib/users/profile-service';
import { ProfileUpdateSchema } from '@/lib/users/schema';

// CANDID-024 — /api/v1/users/me (US-MY-004 프로필 조회/수정).
//
// 보안 컨트롤:
//   1) 전역 middleware — HTTPS / CORS / CSRF Origin / 보안 헤더
//   2) requireAuth — JWT 인증 통과 + AuthContext { userId } 추출. 미인증 → 401 AUTH_TOKEN_*
//   3) (PATCH) enforceUserRateLimit(PROFILE_UPDATE_USER) — 사용자당 20회/시간
//   4) 본인 userId로만 조회/수정. 응답은 마스킹 DTO (평문 PII / passwordHash 비노출, L-006).
//
// prisma 사용 → Node 런타임 강제 (Edge 불가).
export const runtime = 'nodejs';

// GET — 프로필 조회 (Step 1).
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  const profile = await getProfile(ctx.userId);
  return NextResponse.json(profile, { status: 200 });
});

// PATCH — 이름/연락처 부분 수정 (Step 2). 본인만, user-bucket rate limit, 갱신된 마스킹 DTO 반환.
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);

  const userRateLimit = enforceUserRateLimit(
    USER_POLICIES.PROFILE_UPDATE_USER,
    ctx.userId,
    request,
  );
  if (userRateLimit.response !== null) return userRateLimit.response;

  const body = ProfileUpdateSchema.parse(await request.json());
  const profile = await updateProfile(ctx.userId, body);

  const response = NextResponse.json(profile, { status: 200 });
  userRateLimit.attachHeaders(response);
  return response;
});
