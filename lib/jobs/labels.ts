// CANDID-013 Step 2 in-task fix (D-2) — Employment/Career 한국어 라벨 SSOT.
// JobCard, JobsListMetadata가 공유. 불일치 차단 (이전: CAREER.ANY가 '무관' vs '경력 무관'으로 갈림).

import type { CareerLevel, EmploymentType } from '@prisma/client';

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: '정규직',
  CONTRACT: '계약직',
  INTERN: '인턴',
};

export const CAREER_LABEL: Record<CareerLevel, string> = {
  NEW: '신입',
  EXPERIENCED: '경력',
  ANY: '경력 무관',
};
