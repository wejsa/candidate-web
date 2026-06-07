// CANDID-019 Step 2 — 마이페이지 상세 + 타임라인 서비스 (US-MY-002).
//
// 보안:
//   - ownership 강제: where: { id, userId } — 다른 사용자 application 접근 차단
//   - 404 정보 누출 회피: 부재 또는 권한 없음 모두 APP_DRAFT_NOT_FOUND (CANDID-017 패턴)
//   - PII snapshot 5쌍 자동 제외 (Application select 화이트리스트, L-006)
//   - visibleToCandidate=true 필터로 내부 이력 차단
//   - statusHistories select에서 changedByUserId 제외 (어드민 식별자 차단)
//   - interviewSchedules: CANCELLED 제외, 점수/평가 컬럼 schema 부재 + select 명시
//
// 타임라인 정렬: statusHistories.changedAt asc (시간순)
// 면접 정렬: scheduledAt asc (가장 빠른 일정 먼저)

import 'server-only';
import type {
  ApplicationResult,
  InterviewScheduleStatus,
  StageType,
} from '@prisma/client';
import { InterviewScheduleStatus as InterviewStatus } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { interviewStatusLabel, stageLabel } from '@/lib/my-page/stage-labels';
import type {
  InterviewSummary,
  MyApplicationCard,
  MyApplicationDetailResponse,
  TimelineEntry,
} from '@/lib/my-page/types';

interface ApplicationDetailRow {
  id: number;
  applicationNumber: string;
  jobPostingId: number;
  currentStage: StageType;
  result: ApplicationResult;
  submittedAt: Date;
  withdrawnAt: Date | null;
  jobPosting: { id: number; title: string };
  statusHistories: Array<{
    id: number;
    fromStage: StageType | null;
    toStage: StageType;
    changedAt: Date;
  }>;
  interviewSchedules: Array<{
    id: number;
    stage: StageType;
    scheduledAt: Date;
    locationOrUrl: string;
    status: InterviewScheduleStatus;
    icsUid: string;
  }>;
}

const DETAIL_SELECT = {
  id: true,
  applicationNumber: true,
  jobPostingId: true,
  currentStage: true,
  result: true,
  submittedAt: true,
  withdrawnAt: true,
  jobPosting: { select: { id: true, title: true } },
  statusHistories: {
    where: { visibleToCandidate: true },
    orderBy: { changedAt: 'asc' as const },
    select: {
      id: true,
      fromStage: true,
      toStage: true,
      changedAt: true,
      // changedByUserId 제외 — 어드민 식별자 노출 방지
    },
  },
  interviewSchedules: {
    where: { status: { not: InterviewStatus.CANCELLED } },
    orderBy: { scheduledAt: 'asc' as const },
    select: {
      id: true,
      stage: true,
      scheduledAt: true,
      locationOrUrl: true,
      status: true,
      icsUid: true,
      // 면접관 이름 / 점수 / 평가 컬럼 자체가 schema에 없음 — 자연 보호
    },
  },
} as const;

/**
 * 마이페이지 상세 조회. 본인 ownership을 where 절로 강제 — 다른 사용자 데이터 차단.
 *
 * @throws AppError('APP_DRAFT_NOT_FOUND', 404) — 미존재 또는 권한 없음 (정보 누출 회피)
 */
export async function getMyApplicationDetail(
  userId: number,
  applicationId: number,
): Promise<MyApplicationDetailResponse> {
  const app = (await basePrisma.application.findFirst({
    where: { id: applicationId, userId },
    select: DETAIL_SELECT,
  })) as ApplicationDetailRow | null;

  if (app === null) {
    throw new AppError('APP_DRAFT_NOT_FOUND');
  }

  const lastVisibleChange = app.statusHistories[app.statusHistories.length - 1]?.changedAt;
  const summary: MyApplicationCard = {
    applicationId: app.id,
    applicationNumber: app.applicationNumber,
    jobPostingId: app.jobPostingId,
    jobTitle: app.jobPosting.title,
    currentStage: app.currentStage,
    currentStageLabel: stageLabel(app.currentStage),
    result: app.result,
    submittedAt: app.submittedAt.toISOString(),
    withdrawnAt: app.withdrawnAt?.toISOString() ?? null,
    lastStatusChangedAt: (lastVisibleChange ?? app.submittedAt).toISOString(),
  };

  const timeline: TimelineEntry[] = app.statusHistories.map((h) => ({
    id: h.id,
    fromStage: h.fromStage,
    toStage: h.toStage,
    toStageLabel: stageLabel(h.toStage),
    changedAt: h.changedAt.toISOString(),
  }));

  const interviews: InterviewSummary[] = app.interviewSchedules.map((i) => ({
    scheduleId: i.id,
    stage: i.stage,
    stageLabel: stageLabel(i.stage),
    scheduledAt: i.scheduledAt.toISOString(),
    locationOrUrl: i.locationOrUrl,
    status: i.status,
  }));

  // interviewStatusLabel은 클라이언트에서 사용 (현재 DTO는 미포함). 향후 라벨 노출 시 활용.
  void interviewStatusLabel;

  return { summary, timeline, interviews };
}
