import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { requireRole } from '@/lib/auth/require-role';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { clientIpFromRequest } from '@/lib/security/rate-limit';
import { getResumeDownloadForOperator } from '@/lib/admin/applicants';

// CANDID-066 Step 2 — GET /api/admin/v1/applications/{id}/resume (FR-002)
//   운영자(RECRUITER+) 이력서 보안 다운로드: 역할 가드 + 바이러스 게이팅(INFECTED 차단) +
//   fail-closed 감사(RESUME_DOWNLOAD) + 짧은 TTL presigned GET URL 반환.
//   storedPath(S3 키)는 응답에 노출하지 않는다 — presigned URL만 반환.
export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }> | { id: string };
}
const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const GET = withErrorHandler(
  withTraceContext(async (request: NextRequest, ctx: RouteCtx) => {
    const actor = await requireRole(request, UserRole.RECRUITER, UserRole.ADMIN);
    const { id } = ParamsSchema.parse(await ctx.params);
    const result = await getResumeDownloadForOperator({
      actorUserId: actor.userId,
      applicationId: id,
      ipAddress: clientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(result);
  }),
);
