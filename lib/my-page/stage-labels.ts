// CANDID-019 Step 1 — StageType / InterviewScheduleStatus 한국어 라벨 SSOT.
// Job 단계는 PRD §2.4의 사용자 표현을 따른다 (내부 enum 명세는 prisma/schema.prisma).

import {
  ApplicationResult,
  InterviewScheduleStatus,
  StageType,
} from '@prisma/client';

const STAGE_LABELS: Record<StageType, string> = {
  [StageType.SUBMITTED]: '제출 완료',
  [StageType.DOC_REVIEW]: '서류 검토 중',
  [StageType.INTERVIEW_1]: '1차 면접',
  [StageType.INTERVIEW_2]: '2차 면접',
  [StageType.OFFER]: '처우 협의',
  [StageType.HIRED]: '최종 합격',
  [StageType.REJECTED]: '불합격',
};

export function stageLabel(stage: StageType): string {
  return STAGE_LABELS[stage] ?? String(stage);
}

const INTERVIEW_STATUS_LABELS: Record<InterviewScheduleStatus, string> = {
  [InterviewScheduleStatus.SCHEDULED]: '예정',
  [InterviewScheduleStatus.DONE]: '완료',
  [InterviewScheduleStatus.CANCELLED]: '취소됨',
};

export function interviewStatusLabel(status: InterviewScheduleStatus): string {
  return INTERVIEW_STATUS_LABELS[status] ?? String(status);
}

const RESULT_LABELS: Record<ApplicationResult, string> = {
  [ApplicationResult.IN_PROGRESS]: '진행 중',
  [ApplicationResult.PASSED]: '합격',
  [ApplicationResult.FAILED]: '불합격',
  [ApplicationResult.WITHDRAWN]: '철회됨',
};

export function resultLabel(result: ApplicationResult): string {
  return RESULT_LABELS[result] ?? String(result);
}
