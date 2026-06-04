import { NextResponse, type NextRequest } from 'next/server';
import { UserRole } from '@prisma/client';
import { requireRole } from '@/lib/auth/require-role';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { clientIpFromRequest } from '@/lib/security/rate-limit';
import { createJobPosting } from '@/lib/admin/job-postings';
import { JobPostingCreateSchema } from '@/lib/admin/job-postings-schema';

// CANDID-053 Step 4 — POST /api/admin/v1/job-postings (공고 생성, RECRUITER+).
// 항상 DRAFT로 생성되며, 노출(OPEN)은 PATCH 상태 전이로 분리.
export const runtime = 'nodejs';

export const POST = withErrorHandler(
  withTraceContext(async (request: NextRequest) => {
    const actor = await requireRole(request, UserRole.RECRUITER, UserRole.ADMIN);
    const input = JobPostingCreateSchema.parse(await request.json());
    const created = await createJobPosting({
      actorUserId: actor.userId,
      input,
      ipAddress: clientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(created, { status: 201 });
  }),
);
