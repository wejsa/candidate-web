// CANDID-019 Step 2 — GET /api/v1/applications/me/{id} (US-MY-002).
//
// 미들웨어 chain:
//   withErrorHandler → requireAuth → getMyApplicationDetail(userId, id) → 200 응답
//
// 권한 검증: where: { id, userId } — 다른 사용자 application 접근 시 404 (정보 누출 회피).
// 응답: { summary, timeline, interviews } — PII-free.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { getMyApplicationDetail } from '@/lib/my-page/detail-service';
import { AppError, withErrorHandler } from '@/lib/errors';

interface RouteContext {
  params: { id: string };
}

const ApplicationIdSchema = z.coerce.number().int().positive();

export const GET = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const { userId } = await requireAuth(request);

    let applicationId: number;
    try {
      applicationId = ApplicationIdSchema.parse(context.params.id);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new AppError('SYS_VALIDATION_FAILED', {
          message: 'applicationId는 양의 정수여야 합니다.',
          details: err.issues.map((i) => ({
            field: 'applicationId',
            reason: i.message,
          })),
        });
      }
      throw err;
    }

    const data = await getMyApplicationDetail(userId, applicationId);
    return NextResponse.json(data, { status: 200 });
  },
);
