import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { requireRole } from '@/lib/auth/require-role';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { clientIpFromRequest } from '@/lib/security/rate-limit';
import { changeUserRole } from '@/lib/admin/roles';

// CANDID-053 Step 3 — PATCH /api/admin/v1/users/{id}/role (RBAC 역할 관리).
//
// 보안 컨트롤:
//   requireRole(ADMIN) — ADMIN만 역할 변경. 미인증 401 / 권한 부족 403 AUTH_FORBIDDEN.
//   withErrorHandler — zod 실패 SYS_VALIDATION_FAILED, AppError(USER_LAST_ADMIN/USER_CANNOT_CHANGE_OWN_ROLE 등) 표준 변환.
//   withTraceContext — changeUserRole 내부 ROLE_GRANTED/REVOKED 감사에 traceId 전파.
// Prisma 사용 → Node 런타임.

export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }> | { id: string };
}

const ParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const BodySchema = z.object({ role: z.nativeEnum(UserRole) }).strict();

export const PATCH = withErrorHandler(
  withTraceContext(async (request: NextRequest, ctx: RouteCtx) => {
    const actor = await requireRole(request, UserRole.ADMIN);

    const { id } = ParamsSchema.parse(await ctx.params);
    const { role } = BodySchema.parse(await request.json());

    const result = await changeUserRole({
      actorUserId: actor.userId,
      targetUserId: id,
      newRole: role,
      ipAddress: clientIpFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });

    return NextResponse.json(result, { status: 200 });
  }),
);
