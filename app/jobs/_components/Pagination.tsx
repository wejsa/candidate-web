// CANDID-013 Step 2 — 공고 목록 페이지네이션 (서버 컴포넌트, US-JOB-001).
// Link 기반 — URL 쿼리에 page 반영, 새로고침/공유 가능 (AC: URL 상태 유지).
// 윈도우 5개 (current ±2) + 양 끝 단축 표시 (1, …, ..., totalPages).

import Link from 'next/link';
import type { ParsedJobListQuery } from '@/lib/jobs/list';
import { buildPageUrl, getPageWindow } from '@/lib/jobs/pagination-url';

export interface PaginationProps {
  page: number;
  totalPages: number;
  query: ParsedJobListQuery;
  basePath?: string;
}

export function Pagination({ page, totalPages, query, basePath = '/jobs' }: PaginationProps) {
  if (totalPages <= 1) return null;
  const windowPages = getPageWindow(page, totalPages, 2);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const firstInWindow = windowPages[0] ?? 1;
  const lastInWindow = windowPages[windowPages.length - 1] ?? 1;

  return (
    <nav aria-label="페이지 네비게이션">
      <ul>
        {hasPrev && (
          <li>
            <Link rel="prev" href={buildPageUrl({ basePath, query, page: page - 1 })}>
              이전
            </Link>
          </li>
        )}
        {firstInWindow > 1 && (
          <li>
            <Link href={buildPageUrl({ basePath, query, page: 1 })}>1</Link>
          </li>
        )}
        {firstInWindow > 2 && <li aria-hidden>…</li>}
        {windowPages.map((p) =>
          p === page ? (
            <li key={p} aria-current="page">
              <span>{p}</span>
            </li>
          ) : (
            <li key={p}>
              <Link href={buildPageUrl({ basePath, query, page: p })}>{p}</Link>
            </li>
          ),
        )}
        {lastInWindow < totalPages - 1 && <li aria-hidden>…</li>}
        {lastInWindow < totalPages && (
          <li>
            <Link href={buildPageUrl({ basePath, query, page: totalPages })}>{totalPages}</Link>
          </li>
        )}
        {hasNext && (
          <li>
            <Link rel="next" href={buildPageUrl({ basePath, query, page: page + 1 })}>
              다음
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
