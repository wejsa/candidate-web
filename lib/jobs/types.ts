// CANDID-013 Step 1 — 공고 목록 조회 도메인 타입 (US-JOB-001).
// API 응답 + RSC 컴포넌트가 공유한다. 카드 UI에 필요한 최소 필드만 노출.

import type { CareerLevel, EmploymentType } from '@prisma/client';

export type SortKey = 'latest' | 'deadline';

export interface JobListQueryInput {
  category?: string;
  employment?: EmploymentType;
  career?: CareerLevel;
  sort?: SortKey;
  page?: number;
  includeClosed?: boolean;
}

export interface JobListItem {
  id: number;
  title: string;
  employmentType: EmploymentType;
  careerLevel: CareerLevel;
  category: { name: string; slug: string };
  opensAt: Date;
  closesAt: Date | null;
  // 'D-3' | 'D-1' | '오늘 마감' | '상시모집' | null(이미 마감)
  dDayLabel: string | null;
}

export interface JobListPagination {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface JobListResponse {
  items: JobListItem[];
  // page=1 + includeClosed=true에서만 채워짐. 마감 공고 최대 CLOSED_PREVIEW_COUNT 건.
  closedItems?: JobListItem[];
  pagination: JobListPagination;
}
