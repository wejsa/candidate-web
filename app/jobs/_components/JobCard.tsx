// CANDID-013 Step 2 — 공고 카드 (서버 컴포넌트, US-JOB-001 카드형 UI).
// 표시 항목: 포지션명, 직군, 고용형태, 경력, 마감 D-Day, (마감 시) 흐림 처리 + '마감' 뱃지.
//
// CANDID-050 Step 1 — 링크 범위 정정(P1): 네비게이션 링크는 제목 1개로 한정, 메타는 비링크.
// CANDID-050 Step 3 — 시각 재구성(CSS Modules): 카드 표면/그림자 + 메타를 칩으로. DOM 구조
//   (dl/dt/dd, span[aria-label])·접근성 레이블·링크 1개 불변(회귀 테스트 보존).

import Link from 'next/link';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';
import type { JobListItem } from '@/lib/jobs/types';
import styles from './JobCard.module.css';

export interface JobCardProps {
  job: JobListItem;
  closed?: boolean;
}

export function JobCard({ job, closed = false }: JobCardProps) {
  return (
    <article
      aria-label={`${job.title} — ${job.category.name}${closed ? ' (마감)' : ''}`}
      data-closed={closed ? 'true' : 'false'}
      className={`${styles.card}${closed ? ` ${styles.closed}` : ''}`}
    >
      <div className={styles.head}>
        {/* 네비게이션은 제목 링크 1개로 한정 (CANDID-050 P1). */}
        <h2 className={styles.title}>
          <Link href={`/jobs/${job.id}`} className={styles.titleLink}>
            {job.title}
          </Link>
        </h2>
        {job.dDayLabel !== null && (
          <span aria-label="마감일" className={styles.dday}>
            {job.dDayLabel}
          </span>
        )}
        {closed && (
          <span aria-label="모집 상태" className={styles.closedBadge}>
            마감
          </span>
        )}
      </div>
      <dl className={styles.meta}>
        <div className={styles.metaRow}>
          <dt className={styles.dt}>직군</dt>
          <dd className={styles.chip}>{job.category.name}</dd>
        </div>
        <div className={styles.metaRow}>
          <dt className={styles.dt}>고용형태</dt>
          <dd className={styles.chip}>{EMPLOYMENT_LABEL[job.employmentType]}</dd>
        </div>
        <div className={styles.metaRow}>
          <dt className={styles.dt}>경력</dt>
          <dd className={styles.chip}>{CAREER_LABEL[job.careerLevel]}</dd>
        </div>
      </dl>
    </article>
  );
}
