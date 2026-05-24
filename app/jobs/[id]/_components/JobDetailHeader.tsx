// CANDID-014 Step 2 — 공고 상세 헤더 (RSC).
// title / 카테고리 / 고용형태 / 경력 / 모집 기간 / D-Day 표시.

import type { JobDetail } from '@/lib/jobs/types';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';

interface Props {
  job: JobDetail;
}

function formatDate(date: Date | null): string {
  if (date === null) return '상시';
  // 'ko-KR' locale: '2026. 5. 24.' 형태
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function JobDetailHeader({ job }: Props) {
  return (
    <header>
      <h1>{job.title}</h1>
      <dl>
        <dt>직군</dt>
        <dd>{job.category.name}</dd>
        <dt>고용형태</dt>
        <dd>{EMPLOYMENT_LABEL[job.employmentType]}</dd>
        <dt>경력</dt>
        <dd>{CAREER_LABEL[job.careerLevel]}</dd>
        <dt>모집 기간</dt>
        <dd>
          {formatDate(job.opensAt)} ~ {formatDate(job.closesAt)}
        </dd>
        {job.dDayLabel !== null && (
          <>
            <dt>마감</dt>
            <dd>
              {/* 마감 임박 시 시각적 강조는 CSS에 위임 — data-attr로 상태 노출 */}
              <span data-d-day={job.dDayLabel} aria-label={`마감 ${job.dDayLabel}`}>
                {job.dDayLabel}
              </span>
            </dd>
          </>
        )}
        {job.isClosed && (
          <>
            <dt>모집 상태</dt>
            <dd>지원 마감</dd>
          </>
        )}
      </dl>
    </header>
  );
}
