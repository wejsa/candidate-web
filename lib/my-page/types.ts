// CANDID-019 Step 1 — 마이페이지 DTO 타입 (US-MY-001/002).

import type { ApplicationResult, InterviewScheduleStatus, StageType } from '@prisma/client';

/** 작성 중 (Draft) 섹션 카드. */
export interface MyDraftCard {
  draftId: number;
  jobPostingId: number;
  jobTitle: string;
  jobStatus: string; // JobPosting.status — 마감된 공고의 draft 표시 분기용
  lastSavedAt: string; // ISO 8601
}

/**
 * 진행 중 / 종료 섹션 공통 카드.
 * - PII snapshot 컬럼은 응답에 포함하지 않는다 (L-006 — Prisma select 화이트리스트로 제외).
 * - 상태 변경일은 statusHistories.visibleToCandidate=true 의 최신 row.changedAt.
 */
export interface MyApplicationCard {
  applicationId: number;
  applicationNumber: string;
  jobPostingId: number;
  jobTitle: string;
  currentStage: StageType;
  currentStageLabel: string; // 한국어
  result: ApplicationResult;
  submittedAt: string; // ISO
  withdrawnAt: string | null;
  /** 상태 변경일 — visible status_history 최신 row.changedAt. 미존재 시 submittedAt. */
  lastStatusChangedAt: string;
}

export interface MyApplicationListResponse {
  drafts: MyDraftCard[];
  inProgress: MyApplicationCard[];
  closed: MyApplicationCard[];
}

/** 타임라인 항목 (statusHistories visible=true 만, 시간순). */
export interface TimelineEntry {
  id: number;
  fromStage: StageType | null;
  toStage: StageType;
  toStageLabel: string;
  changedAt: string; // ISO
}

/** 면접 일정 요약 — 점수/평가/면접관 이름 일체 포함하지 않음. */
export interface InterviewSummary {
  scheduleId: number;
  stage: StageType;
  stageLabel: string;
  scheduledAt: string; // ISO
  locationOrUrl: string;
  status: InterviewScheduleStatus;
}

export interface MyApplicationDetailResponse {
  summary: MyApplicationCard;
  timeline: TimelineEntry[];
  interviews: InterviewSummary[];
}
