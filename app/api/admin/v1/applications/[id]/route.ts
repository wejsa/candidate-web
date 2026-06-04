import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { requireRole } from '@/lib/auth/require-role';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { clientIpFromRequest } from '@/lib/security/rate-limit';
import { getApplicantDetailForOperator } from '@/lib/admin/applicants';

// CANDID-053 Step 5 — GET /api/admin/v1/applications/{id}
//   운영자 지원서 상세(동결 PII 복호화, RECRUITER+). 명시 열람 → PII_VIEW 감사.
export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }> | { id: string };
}
const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const GET = withErrorHandler(
  withTraceContext(async (request: NextRequest, ctx: RouteCtx) => {
    const actor = await requireRole(request, UserRole.RECRUITER, UserRole.ADMIN);
    const { id } = ParamsSchema.parse(await ctx.params);
    const detail = await getApplicantDetailForOperator({
      actorUserId: actor.userId,
      applicationId: id,
      ipAddress: clientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(detail, { status: 200 });
  }),
);
