// CANDID-013 Step 2 — 공고 목록 페이지 (RSC, US-JOB-001).
// SSR(force-dynamic) — 필터/페이지가 동적이라 SSG/ISR 불가. unstable_cache(60s)가 DB 부하 흡수.
// generateMetadata: title/description/OG 동적 (AC: 메타 태그 동적 생성).
// 마감 섹션(ClosedJobsSection)과 필터(JobFilters, client)는 Step 3에서 통합.

import type { Metadata } from 'next';
import { JobListQuerySchema, listJobs } from '@/lib/jobs/list';
import { buildJobsListMetadata } from '@/lib/jobs/metadata';
import { JobCard } from '@/app/jobs/_components/JobCard';
import { Pagination } from '@/app/jobs/_components/Pagination';

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

// 필터/페이지가 매 요청 변경 → SSG/ISR 부적합.
export const dynamic = 'force-dynamic';

function flatten(raw: PageProps['searchParams']): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  // 검증 실패 시 기본 메타데이터로 폴백 (잘못된 URL로 SEO 오염 방지).
  try {
    const query = JobListQuerySchema.parse(flatten(searchParams));
    // total은 미페치 — 메타 생성을 위해 별도 카운트 호출은 비효율적.
    // (description은 total 없이도 의미 전달 가능 — buildJobsListMetadata가 분기 처리)
    return buildJobsListMetadata({ query, total: 0 });
  } catch {
    return {
      title: '채용 공고',
      description: '자사 채용 공고 목록',
      robots: { index: true, follow: true },
    };
  }
}

export default async function JobsPage({ searchParams }: PageProps) {
  // 잘못된 query는 listJobs 호출 전에 zod가 throw → Next.js 기본 error.tsx 폴백.
  // 정상 사용자는 필터 UI로만 query를 변경하므로 정상 경로.
  const query = JobListQuerySchema.parse(flatten(searchParams));
  const data = await listJobs(query);

  return (
    <main>
      <h1>채용 공고</h1>
      {/* Step 3에서 JobFilters (client) 마운트 예정 */}
      {data.items.length === 0 ? (
        <p>조건에 맞는 공고가 없습니다.</p>
      ) : (
        <>
          <p aria-live="polite">
            총 {data.pagination.total.toLocaleString('ko-KR')}건 · 페이지 {data.pagination.page}/
            {data.pagination.totalPages}
          </p>
          <ul>
            {data.items.map((job) => (
              <li key={job.id}>
                <JobCard job={job} />
              </li>
            ))}
          </ul>
          <Pagination
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            query={query}
          />
        </>
      )}
      {/* Step 3에서 ClosedJobsSection으로 추출 — 현재는 data.closedItems 미렌더 */}
    </main>
  );
}
