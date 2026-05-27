// CANDID-019 Step 2 — GET /api/v1/applications/me/{id}/interview.ics?scheduleId=N
//
// 면접 일정 .ics 다운로드 endpoint. ownership 강제 + status != CANCELLED 필터.
//
// 응답: text/calendar; charset=utf-8 (RFC 5545)
// Content-Disposition: attachment; filename="interview-{icsUid}.ics"

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { getMyInterviewSchedule } from '@/lib/my-page/detail-service';
import { buildInterviewIcs, buildInterviewSummary } from '@/lib/my-page/ics';
import { stageLabel } from '@/lib/my-page/stage-labels';
import { AppError, withErrorHandler } from '@/lib/errors';

interface RouteContext {
  params: { id: string };
}

const IdSchema = z.coerce.number().int().positive();

export const GET = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const { userId } = await requireAuth(request);

    let applicationId: number;
    let scheduleId: number;
    try {
      applicationId = IdSchema.parse(context.params.id);
      const rawSchedule = request.nextUrl.searchParams.get('scheduleId');
      scheduleId = IdSchema.parse(rawSchedule);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new AppError('SYS_VALIDATION_FAILED', {
          message: 'applicationId / scheduleId는 양의 정수여야 합니다.',
          details: err.issues.map((i) => ({
            field: i.path.join('.') || 'scheduleId',
            reason: i.message,
          })),
        });
      }
      throw err;
    }

    const schedule = await getMyInterviewSchedule(userId, applicationId, scheduleId);

    const summary = buildInterviewSummary(
      schedule.jobTitle,
      schedule.stage,
      stageLabel(schedule.stage),
    );
    const ics = buildInterviewIcs({
      uid: schedule.icsUid,
      scheduledAt: schedule.scheduledAt,
      summary,
      location: schedule.locationOrUrl,
      description: `지원 번호: ${schedule.applicationNumber}`,
    });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="interview-${schedule.icsUid}.ics"`,
        'Cache-Control': 'private, no-store',
      },
    });
  },
);
