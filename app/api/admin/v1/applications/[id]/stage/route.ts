import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { requireRole } from '@/lib/auth/require-role';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { clientIpFromRequest } from '@/lib/security/rate-limit';
import { transitionApplicationStage } from '@/lib/admin/stage-transition';
import { StageTransitionSchema } from '@/lib/admin/stage-transition-schema';

// CANDID-053 Step 6 — PATCH /api/admin/v1/applications/{id}/stage
//   전형 단계 전이(그래프 검증 + 이력 + 결과 결정, RECRUITER+). FR-007.
export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }> | { id: string };
}
const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const PATCH = withErrorHandler(
  withTraceContext(async (request: NextRequest, ctx: RouteCtx) => {
    const actor = await requireRole(request, UserRole.RECRUITER, UserRole.ADMIN);
    const { id } = ParamsSchema.parse(await ctx.params);
    const { toStage } = StageTransitionSchema.parse(await request.json());
    const result = await transitionApplicationStage({
      actorUserId: actor.userId,
      applicationId: id,
      toStage,
      ipAddress: clientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(result, { status: 200 });
  }),
);
