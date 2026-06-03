// CANDID-013 Step 3 — 공고 목록 필터 UI (Client Component, US-JOB-001).
// useRouter + useSearchParams로 URL 동기화 (AC: URL 쿼리 상태 유지, 공유 가능).
// 필터 1개 변경 시 page=1로 리셋. 모든 필터 해제는 '초기화' 버튼.
//
// JobCategory.slug 목록은 SSR에서 prefetch해 props로 전달 (F-6 backlog는 별도 task).
// 본 step에서는 빈 배열도 허용 (사용자가 직접 slug 입력하지는 않음 — 추후 dropdown 채울 예정).

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';
import { applyFilterChange, buildResetUrl, type FilterField } from '@/lib/jobs/filter-changes';
import { JobListQuerySchema, type ParsedJobListQuery } from '@/lib/jobs/schema';
import styles from './JobFilters.module.css';

export interface JobFiltersProps {
  basePath?: string;
  categories?: ReadonlyArray<{ slug: string; name: string }>;
}

const EMPLOYMENT_OPTIONS = Object.entries(EMPLOYMENT_LABEL) as Array<[string, string]>;
const CAREER_OPTIONS = Object.entries(CAREER_LABEL) as Array<[string, string]>;

export function JobFilters({ basePath = '/jobs', categories = [] }: JobFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // 현재 URL → query. parse 실패 시 기본값 폴백 (사용자 직접 URL 조작 방어).
  const current: ParsedJobListQuery = (() => {
    try {
      const raw: Record<string, string> = {};
      searchParams.forEach((v, k) => {
        raw[k] = v;
      });
      return JobListQuerySchema.parse(raw);
    } catch {
      return JobListQuerySchema.parse({});
    }
  })();

  const handleChange = useCallback(
    (field: FilterField) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      const value =
        e.target instanceof HTMLInputElement && e.target.type === 'checkbox'
          ? e.target.checked
          : e.target.value;
      const url = applyFilterChange({ basePath, query: current, field, value });
      startTransition(() => {
        router.push(url);
      });
    },
    [basePath, current, router],
  );

  const handleReset = useCallback(() => {
    startTransition(() => {
      router.push(buildResetUrl(basePath));
    });
  }, [basePath, router]);

  return (
    <section aria-label="공고 필터" aria-busy={pending} className={styles.filters}>
      <label>
        직군
        <select
          value={current.category ?? ''}
          onChange={handleChange('category')}
          disabled={pending}
        >
          <option value="">전체</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        고용형태
        <select
          value={current.employment ?? ''}
          onChange={handleChange('employment')}
          disabled={pending}
        >
          <option value="">전체</option>
          {EMPLOYMENT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        경력
        <select value={current.career ?? ''} onChange={handleChange('career')} disabled={pending}>
          <option value="">전체</option>
          {CAREER_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        정렬
        <select value={current.sort} onChange={handleChange('sort')} disabled={pending}>
          <option value="latest">최신순</option>
          <option value="deadline">마감임박순</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={current.includeClosed}
          onChange={handleChange('includeClosed')}
          disabled={pending}
        />
        마감 공고 표시
      </label>
      <button type="button" onClick={handleReset} disabled={pending}>
        초기화
      </button>
    </section>
  );
}
