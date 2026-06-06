import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { requireRole } from '@/lib/auth/require-role';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { clientIpFromRequest } from '@/lib/security/rate-limit';
import { upsertInterviewSchedule } from '@/lib/admin/interviews';
import { InterviewUpsertSchema } from '@/lib/admin/interviews-schema';

// CANDID-053 Step 7 — POST /api/admin/v1/applications/{id}/interviews
//   면접 일정 생성/변경(icsUid 멱등, RECRUITER+). 후보자 마이페이지에 자동 반영.
export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }> | { id: string };
}
const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const POST = withErrorHandler(
  withTraceContext(async (request: NextRequest, ctx: RouteCtx) => {
    const actor = await requireRole(request, UserRole.RECRUITER, UserRole.ADMIN);
    const { id } = ParamsSchema.parse(await ctx.params);
    const input = InterviewUpsertSchema.parse(await request.json());
    const result = await upsertInterviewSchedule({
      actorUserId: actor.userId,
      applicationId: id,
      stage: input.stage,
      scheduledAt: new Date(input.scheduledAt),
      locationOrUrl: input.locationOrUrl,
      ipAddress: clientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });
    // 신규=201, 멱등 갱신=200.
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  }),
);
