import { JobStatus } from '@prisma/client';

// CANDID-053 — 공고 상태 전이 그래프 SSOT (서버/클라이언트 공용).
//   server-only가 아닌 순수 모듈 — 서버(lib/admin/job-postings.ts: 최종 강제)와
//   클라이언트(StatusControl: UX 힌트)가 **같은 정의를 import**해 드리프트를 구조적으로 차단한다.
//   FR-005 `DRAFT↔OPEN→CLOSED`: DRAFT↔OPEN 양방향(잘못 공개 회수), CLOSED는 종단.

export const JOB_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  DRAFT: [JobStatus.OPEN, JobStatus.CLOSED],
  OPEN: [JobStatus.DRAFT, JobStatus.CLOSED],
  CLOSED: [],
};
