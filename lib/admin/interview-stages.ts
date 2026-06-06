import { StageType } from '@prisma/client';

// CANDID-053 — 면접 단계 SSOT (서버/클라이언트 공용). BR-APP-08: 면접은 INTERVIEW_1/INTERVIEW_2만.
//   server-only가 아닌 순수 모듈 — 서버 스키마(interviews-schema.ts: z.enum 강제)와
//   클라 폼(InterviewScheduleForm: select 노출)이 **같은 정의를 import**해 드리프트를 구조적으로 차단한다.
//   (전이 그래프 stage-transitions-graph.ts와 동일 패턴.)

export const INTERVIEW_STAGES = [StageType.INTERVIEW_1, StageType.INTERVIEW_2] as const;
