import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { requireRole } from '@/lib/auth/require-role';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { listApplicantsByPosting } from '@/lib/admin/applicants';
import { parseApplicantListQuery } from '@/lib/admin/applicants-schema';

// CANDID-053 Step 5 — GET /api/admin/v1/job-postings/{id}/applications
//   공고별 지원자 목록(페이지네이션 + 마스킹, RECRUITER+). FR-006.
export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }> | { id: string };
}
const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const GET = withErrorHandler(
  withTraceContext(async (request: NextRequest, ctx: RouteCtx) => {
    await requireRole(request, UserRole.RECRUITER, UserRole.ADMIN);
    const { id } = ParamsSchema.parse(await ctx.params);
    const { page, stage } = parseApplicantListQuery(request.nextUrl.searchParams);
    const result = await listApplicantsByPosting({ jobPostingId: id, page, stage });
    return NextResponse.json(result, { status: 200 });
  }),
);
