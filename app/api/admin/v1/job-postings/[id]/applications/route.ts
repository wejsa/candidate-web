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
    // posting(공고 제목)은 운영 대시보드 헤더 전용 필드 — v1 응답 계약 보존을 위해 제외.
    // (perPage 상수 분리와 동일한 "v1 계약 누수 차단" 규율: lib/admin/applicants.ts 참조)
    const { posting: _posting, ...listContract } = await listApplicantsByPosting({
      jobPostingId: id,
      page,
      stage,
    });
    return NextResponse.json(listContract, { status: 200 });
  }),
);
