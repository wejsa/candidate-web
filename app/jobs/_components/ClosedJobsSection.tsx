// CANDID-013 Step 3 — 마감 공고 별도 섹션 (서버 컴포넌트, US-JOB-001).
// AC: "마감일이 지난 공고는 별도 섹션 또는 흐릿한 처리로 표시(완전 숨김 X — SEO 자산 보존)"
// listJobs(page=1, includeClosed=true)에서 최대 CLOSED_PREVIEW_COUNT(=5)건 제공.

import type { JobListItem } from '@/lib/jobs/types';
import { JobCard } from './JobCard';

export interface ClosedJobsSectionProps {
  items: JobListItem[];
}

export function ClosedJobsSection({ items }: ClosedJobsSectionProps) {
  if (items.length === 0) return null;

  return (
    <section aria-label="마감된 공고">
      <hr aria-hidden style={{ margin: '24px 0' }} />
      <h2>마감된 공고</h2>
      <p>최근 마감된 공고 {items.length}건입니다.</p>
      <ul>
        {items.map((job) => (
          <li key={`closed-${job.id}`}>
            <JobCard job={job} closed />
          </li>
        ))}
      </ul>
    </section>
  );
}
