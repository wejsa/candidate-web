import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withErrorHandler } from '@/lib/errors';
import { getProfile } from '@/lib/users/profile-service';

// CANDID-024 Step 1 — GET /api/v1/users/me (US-MY-004 프로필 조회).
//
// 보안 컨트롤:
//   1) 전역 middleware — HTTPS / CORS / 보안 헤더
//   2) requireAuth — JWT 인증 통과 + AuthContext { userId } 추출. 미인증 → 401 AUTH_TOKEN_*
//   3) getProfile — 본인 프로필만 반환. 응답은 마스킹 DTO (평문 PII / passwordHash 비노출, L-006).
//
// prisma 사용 → Node 런타임 강제 (Edge 불가).
export const runtime = 'nodejs';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  const profile = await getProfile(ctx.userId);
  return NextResponse.json(profile, { status: 200 });
});
