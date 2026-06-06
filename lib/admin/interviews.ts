import 'server-only';
import {
  ApplicationResult,
  AuditEventType,
  InterviewScheduleStatus,
  type StageType,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { recordAuditEvent } from '@/lib/audit/record';

// CANDID-053 Step 7 — 면접 일정 writer (생성/변경, RBAC A안. FR).
//
// 도메인:
//   - icsUid는 (지원서, 면접단계)당 결정적(`iv-{appId}-{stage}`) → **멱등**. 동일 단계 재등록은
//     중복 생성이 아니라 일정 갱신(UNIQUE(ics_uid) + upsert). .ics 발급 UID 안정성도 보장.
//   - 신규 등록 → INTERVIEW_SCHEDULED, 기존 갱신 → INTERVIEW_UPDATED 감사. 단일 트랜잭션.
//   - 생성된 일정은 후보자 마이페이지(getMyApplicationDetail)에 자동 반영(CANCELLED 제외).

/** (지원서, 면접단계)당 결정적 icsUid — 멱등성/.ics UID SSOT. */
export function icsUidFor(applicationId: number, stage: StageType): string {
  return `iv-${applicationId}-${stage}`;
}

export interface UpsertInterviewArgs {
  actorUserId: number;
  applicationId: number;
  stage: StageType;
  scheduledAt: Date;
  locationOrUrl: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface InterviewScheduleResult {
  interviewId: number;
  applicationId: number;
  stage: StageType;
  scheduledAt: Date;
  locationOrUrl: string;
  status: InterviewScheduleStatus;
  icsUid: string;
  /** true=신규 생성, false=기존 갱신(멱등 재등록). */
  created: boolean;
}

export async function upsertInterviewSchedule(
  args: UpsertInterviewArgs,
): Promise<InterviewScheduleResult> {
  const { actorUserId, applicationId, stage, scheduledAt, locationOrUrl } = args;
  const icsUid = icsUidFor(applicationId, stage);

  return prisma.$transaction(async (tx) => {
    // 존재 + 상태 검증을 트랜잭션 내부로(TOCTOU 제거 + FK 위반 500 대신 명확한 404).
    const appRow = await tx.application.findUnique({
      where: { id: applicationId },
      select: { id: true, result: true },
    });
    if (appRow === null) {
      throw new AppError('APP_NOT_FOUND');
    }
    // 철회 지원서에는 면접 등록 불가 — Step 6 전이 가드(WITHDRAWN 종단)와 정합.
    // (철회 후보 마이페이지에 면접/.ics가 노출되는 데이터 정합성 비대칭 차단)
    if (appRow.result === ApplicationResult.WITHDRAWN) {
      throw new AppError('APP_INVALID_STAGE_TRANSITION', {
        message: '철회된 지원서에는 면접 일정을 등록할 수 없습니다.',
        details: [{ field: 'applicationId', reason: 'application withdrawn' }],
      });
    }

    const existing = await tx.interviewSchedule.findUnique({
      where: { icsUid },
      select: { id: true },
    });
    const created = existing === null;

    const saved = await tx.interviewSchedule.upsert({
      where: { icsUid },
      create: {
        applicationId,
        stage,
        scheduledAt,
        locationOrUrl,
        icsUid,
        status: InterviewScheduleStatus.SCHEDULED,
      },
      // 재등록은 일정/장소 갱신 + 재활성(취소 후 재등록 케이스 포함).
      update: {
        scheduledAt,
        locationOrUrl,
        status: InterviewScheduleStatus.SCHEDULED,
      },
      select: {
        id: true,
        stage: true,
        scheduledAt: true,
        locationOrUrl: true,
        status: true,
        icsUid: true,
      },
    });

    await recordAuditEvent(
      {
        eventType: created ? AuditEventType.INTERVIEW_SCHEDULED : AuditEventType.INTERVIEW_UPDATED,
        actorUserId,
        resourceType: 'interview_schedule',
        resourceId: String(saved.id),
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
        metadata: { applicationId, stage, status: saved.status }, // PII-free (enum/id만)
      },
      { tx },
    );

    return {
      interviewId: saved.id,
      applicationId,
      stage: saved.stage,
      scheduledAt: saved.scheduledAt,
      locationOrUrl: saved.locationOrUrl,
      status: saved.status,
      icsUid: saved.icsUid,
      created,
    };
  });
}
