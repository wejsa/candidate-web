// CANDID-013 Step 2 — 공고 카드 (서버 컴포넌트, US-JOB-001 카드형 UI).
// 표시 항목: 포지션명, 직군, 고용형태, 경력, 마감 D-Day, (마감 시) 흐림 처리 + '마감' 뱃지.
//
// CANDID-050 Step 1 — 링크 범위 정정(P1): 카드 전체를 단일 <Link>로 감싸면
// 직군/고용형태/경력·D-Day 메타까지 전역 `a` 색을 상속해 "카드 텍스트가 전부 하이퍼링크"로
// 보인다. 네비게이션 링크는 **제목 1개**로 한정하고, 메타는 링크 밖 일반 텍스트로 둔다.
// (카드 시각 재구성·칩 스타일은 Step 3에서 CSS Modules로 처리.)

import Link from 'next/link';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';
import type { JobListItem } from '@/lib/jobs/types';

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
      {/* 네비게이션은 제목 링크 1개로 한정 (CANDID-050 P1). */}
      <h2>
        <Link href={`/jobs/${job.id}`}>{job.title}</Link>
      </h2>
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
    </article>
  );
}
