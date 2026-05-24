// CANDID-013 Step 2 — 페이지네이션 URL 빌더 (US-JOB-001 URL 쿼리 상태 유지).
// Pagination 컴포넌트에서 사용. 순수 함수 — unit 테스트 분리.

import type { ParsedJobListQuery } from '@/lib/jobs/list';

export interface PageUrlInput {
  basePath: string;
  query: ParsedJobListQuery;
  page: number;
}

// 현재 query 상태를 보존하면서 page만 교체. 기본값(latest/page=1/includeClosed=true)은 생략.
export function buildPageUrl({ basePath, query, page }: PageUrlInput): string {
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  if (query.employment) params.set('employment', query.employment);
  if (query.career) params.set('career', query.career);
  if (query.sort !== 'latest') params.set('sort', query.sort);
  if (query.includeClosed === false) params.set('includeClosed', 'false');
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// current 주변 ±window 페이지 번호 목록. 양쪽 경계 클램프.
// 예: current=5, totalPages=20, window=2 → [3,4,5,6,7]
//     current=1, totalPages=20, window=2 → [1,2,3]
//     current=20, totalPages=20, window=2 → [18,19,20]
export function getPageWindow(current: number, totalPages: number, window = 2): number[] {
  if (totalPages <= 0) return [];
  const c = Math.max(1, Math.min(current, totalPages));
  const start = Math.max(1, c - window);
  const end = Math.min(totalPages, c + window);
  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
}
