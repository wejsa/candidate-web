import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { requireRole } from '@/lib/auth/require-role';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { clientIpFromRequest } from '@/lib/security/rate-limit';
import { updateJobPosting } from '@/lib/admin/job-postings';
import { JobPostingUpdateSchema } from '@/lib/admin/job-postings-schema';

// CANDID-053 Step 4 — PATCH /api/admin/v1/job-postings/{id} (공고 수정/상태 전이, RECRUITER+).
export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }> | { id: string };
}
const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const PATCH = withErrorHandler(
  withTraceContext(async (request: NextRequest, ctx: RouteCtx) => {
    const actor = await requireRole(request, UserRole.RECRUITER, UserRole.ADMIN);
    const { id } = ParamsSchema.parse(await ctx.params);
    const patch = JobPostingUpdateSchema.parse(await request.json());
    const updated = await updateJobPosting({
      actorUserId: actor.userId,
      jobPostingId: id,
      patch,
      ipAddress: clientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(updated, { status: 200 });
  }),
);
