// CANDID-013 Step 2 — 공고 카드 (서버 컴포넌트, US-JOB-001 카드형 UI).
// 표시 항목: 포지션명, 직군, 고용형태, 경력, 마감 D-Day, (마감 시) 흐림 처리 + '마감' 뱃지.
// 상세 페이지 라우트 /jobs/[id]는 CANDID-014에서 추가 — 본 step에서는 href만 선언.

import Link from 'next/link';
import type { JobListItem } from '@/lib/jobs/types';

const EMPLOYMENT_LABEL: Record<JobListItem['employmentType'], string> = {
  FULL_TIME: '정규직',
  CONTRACT: '계약직',
  INTERN: '인턴',
};

const CAREER_LABEL: Record<JobListItem['careerLevel'], string> = {
  NEW: '신입',
  EXPERIENCED: '경력',
  ANY: '경력 무관',
};

export interface JobCardProps {
  job: JobListItem;
  closed?: boolean;
}

export function JobCard({ job, closed = false }: JobCardProps) {
  // 마감 카드는 SEO 자산 보존 + 흐림 처리. 키보드 포커스/스크린리더 접근은 유지.
  const wrapperStyle: React.CSSProperties | undefined = closed
    ? { opacity: 0.55 }
    : undefined;

  return (
    <article
      aria-label={`${job.title} — ${job.category.name}${closed ? ' (마감)' : ''}`}
      style={wrapperStyle}
      data-closed={closed ? 'true' : 'false'}
    >
      <Link href={`/jobs/${job.id}`}>
        <h2>{job.title}</h2>
        <dl>
          <div>
            <dt>직군</dt>
            <dd>{job.category.name}</dd>
          </div>
          <div>
            <dt>고용형태</dt>
            <dd>{EMPLOYMENT_LABEL[job.employmentType]}</dd>
          </div>
          <div>
            <dt>경력</dt>
            <dd>{CAREER_LABEL[job.careerLevel]}</dd>
          </div>
        </dl>
        {job.dDayLabel !== null && <span aria-label="마감일">{job.dDayLabel}</span>}
        {closed && <span aria-label="모집 상태">마감</span>}
      </Link>
    </article>
  );
}
