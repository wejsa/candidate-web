// CANDID-013 Step 1 — 공고 목록 조회 도메인 타입 (US-JOB-001).
// CANDID-014 Step 1 — 공고 상세 조회 타입 추가 (US-JOB-002).
// API 응답 + RSC 컴포넌트가 공유한다.

import type { CareerLevel, EmploymentType, QuestionType, JobStatus } from '@prisma/client';

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

// === CANDID-014: 공고 상세 (US-JOB-002) ===

export interface JobQuestion {
  id: number;
  questionText: string;
  questionType: QuestionType;
  required: boolean;
  maxLength: number | null;
  // SELECT/MULTI_SELECT 선택지 JSON 배열. 단순 텍스트 타입은 null.
  options: unknown;
  sortOrder: number;
}

export interface JobDetail {
  id: number;
  title: string;
  employmentType: EmploymentType;
  careerLevel: CareerLevel;
  category: { name: string; slug: string };
  // 출력 시점 sanitized HTML — BR-JOB-04/BR-SEC-05 이중 방어.
  contentHtmlSanitized: string;
  opensAt: Date;
  closesAt: Date | null;
  // DRAFT는 404 — 응답에는 OPEN | CLOSED만 노출.
  status: Exclude<JobStatus, 'DRAFT'>;
  // status===CLOSED || closesAt<=now — F-1 cron 미도입 가드 (캐시 외부 계산).
  isClosed: boolean;
  // 'D-3' | 'D-1' | '오늘 마감' | '상시모집' | null(이미 마감)
  dDayLabel: string | null;
  questions: JobQuestion[];
}
