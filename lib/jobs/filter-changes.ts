// CANDID-013 Step 3 — 필터 변경 → URL 빌드 helper (US-JOB-001 AC: URL 쿼리 상태 유지).
// JobFilters(client)에서 useRouter.push 인자로 사용. 필터 1개 변경 시 page=1로 리셋.
// 순수 함수 — unit 테스트 분리.

import type { CareerLevel, EmploymentType } from '@prisma/client';
import { buildPageUrl } from '@/lib/jobs/pagination-url';
import type { ParsedJobListQuery } from '@/lib/jobs/schema';
import type { SortKey } from '@/lib/jobs/types';

export type FilterField = 'category' | 'employment' | 'career' | 'sort' | 'includeClosed';

export type FilterValue = string | EmploymentType | CareerLevel | SortKey | boolean | null;

export interface ApplyFilterInput {
  basePath: string;
  query: ParsedJobListQuery;
  field: FilterField;
  value: FilterValue;
}

// 필터 한 개 갱신한 새 query를 만들고, buildPageUrl로 URL 생성.
// 필터 변경은 항상 page=1로 리셋 (사용자 직관: 새 필터 → 결과 처음부터).
// value=null/undefined/'' → 해당 필터 해제.
export function applyFilterChange({ basePath, query, field, value }: ApplyFilterInput): string {
  const next: ParsedJobListQuery = { ...query, page: 1 };

  if (value === null || value === undefined || value === '') {
    if (field === 'sort') {
      next.sort = 'latest';
    } else if (field === 'includeClosed') {
      next.includeClosed = true;
    } else {
      next[field] = undefined;
    }
  } else if (field === 'includeClosed') {
    next.includeClosed = value === true || value === 'true';
  } else if (field === 'sort') {
    next.sort = value as SortKey;
  } else if (field === 'category') {
    next.category = String(value);
  } else if (field === 'employment') {
    next.employment = value as EmploymentType;
  } else if (field === 'career') {
    next.career = value as CareerLevel;
  }

  return buildPageUrl({ basePath, query: next, page: 1 });
}

// 모든 필터 해제 — 정렬 latest, page 1, includeClosed true 기본값. /jobs로 복귀.
export function buildResetUrl(basePath: string): string {
  return basePath;
}
