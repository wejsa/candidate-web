import { NextResponse, type NextRequest } from 'next/server';
import { AuditEventType } from '@prisma/client';
import { requireAuth } from '@/lib/auth/middleware';
import { recordAuditEvent } from '@/lib/audit/record';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import {
  USER_POLICIES,
  clientIpFromRequest,
  enforceUserRateLimit,
} from '@/lib/security/rate-limit';
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

// GET — 프로필 조회 (Step 1). CANDID-026 Step 3: 복호화 PII 반환 지점에 PII_VIEW 감사.
//   withTraceContext로 traceId 컨텍스트 seed. metadata는 조회 값 없이 resourceId(userId)만 — 감사 로그가
//   PII 유출 경로가 되지 않도록 조회된 PII 값은 절대 기록하지 않는다(db-designer §4).
export const GET = withErrorHandler(
  withTraceContext(async (request: NextRequest) => {
    const ctx = await requireAuth(request);
    const profile = await getProfile(ctx.userId);
    await recordAuditEvent({
      eventType: AuditEventType.PII_VIEW,
      actorUserId: ctx.userId,
      resourceType: 'user',
      resourceId: String(ctx.userId),
      ipAddress: clientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(profile, { status: 200 });
  }),
);

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
