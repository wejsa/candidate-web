import { StageType } from '@prisma/client';

// CANDID-053 — 전형 단계 전이 그래프 SSOT (서버/클라이언트 공용).
//   server-only가 아닌 순수 모듈 — 서버(lib/admin/stage-transition.ts: 최종 강제)와
//   클라이언트(StageTransitionControl: UX 힌트)가 **같은 정의를 import**해 드리프트를 구조적으로 차단한다.
//   각 단계 → 진행 단계(들) + REJECTED. HIRED/REJECTED는 종단. (BR-APP-07)

export const STAGE_TRANSITIONS: Record<StageType, readonly StageType[]> = {
  [StageType.SUBMITTED]: [StageType.DOC_REVIEW, StageType.REJECTED],
  [StageType.DOC_REVIEW]: [StageType.INTERVIEW_1, StageType.REJECTED],
  [StageType.INTERVIEW_1]: [StageType.INTERVIEW_2, StageType.OFFER, StageType.REJECTED], // 2차 생략 허용
  [StageType.INTERVIEW_2]: [StageType.OFFER, StageType.REJECTED],
  [StageType.OFFER]: [StageType.HIRED, StageType.REJECTED],
  [StageType.HIRED]: [],
  [StageType.REJECTED]: [],
};
