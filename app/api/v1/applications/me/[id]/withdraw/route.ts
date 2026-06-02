// CANDID-023 Step 3 — POST /api/v1/applications/me/{id}/withdraw (US-MY-003).
//
// 미들웨어 chain:
//   withErrorHandler → requireAuth → withdrawApplication(userId, id, reason) → 200 응답
//
// 권한: withdrawApplication 내부 조건부 UPDATE의 `WHERE userId` 가드로 소유권 검증.
//   타인/미존재/종결 지원은 모두 409 APP_NOT_WITHDRAWABLE (정보 누출 회피).
// body: reason 선택 — 빈 body({}) 허용(사유 미입력 철회). WithdrawRequestSchema로 trim+≤500 검증.
// 감사: userAgent는 헤더에서 주입, ipAddress는 CANDID-026 통일 전까지 null (account-withdraw 일관).

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { withdrawApplication } from '@/lib/applications/withdraw';
import { WithdrawRequestSchema } from '@/lib/applications/schema';
import { AppError, withErrorHandler } from '@/lib/errors';

interface RouteContext {
  params: { id: string };
}

const ApplicationIdSchema = z.coerce.number().int().positive();

export const POST = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const { userId } = await requireAuth(request);

    let applicationId: number;
    try {
      applicationId = ApplicationIdSchema.parse(context.params.id);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new AppError('SYS_VALIDATION_FAILED', {
          message: 'applicationId는 양의 정수여야 합니다.',
          details: err.issues.map((i) => ({ field: 'applicationId', reason: i.message })),
        });
      }
      throw err;
    }

    // 빈 body 허용 — request.json()이 빈 본문에 throw하므로 {} 폴백 후 검증.
    let reason: string | undefined;
    try {
      const raw = (await request.json().catch(() => ({}))) as unknown;
      const body = WithdrawRequestSchema.parse(raw ?? {});
      reason = body.reason;
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new AppError('SYS_VALIDATION_FAILED', {
          message: '요청 본문이 올바르지 않습니다.',
          details: err.issues.map((i) => ({
            field: i.path.join('.') || 'body',
            reason: i.message,
          })),
        });
      }
      throw err;
    }

    const result = await withdrawApplication({
      userId,
      applicationId,
      reason: reason ?? null,
      userAgent: request.headers.get('user-agent'),
      // X-Forwarded-For 미신뢰 — CANDID-026 감사 IP 통일 전까지 null (account-withdraw 일관).
      ipAddress: null,
    });

    return NextResponse.json(result, { status: 200 });
  },
);
