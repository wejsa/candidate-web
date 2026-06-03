// CANDID-014 Step 2 — 공고 상세 헤더 (RSC).
// title / 카테고리 / 고용형태 / 경력 / 모집 기간 / D-Day 표시.
// CANDID-050 Step 4 — 시각 재구성(CSS Modules): 칩 헤더. dl/dt/dd·data-d-day·aria 보존.

import type { JobDetail } from '@/lib/jobs/types';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';
import styles from './JobDetailHeader.module.css';

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
    <header className={styles.header}>
      <h1 className={styles.title}>{job.title}</h1>
      <dl className={styles.meta}>
        <div className={styles.chip}>
          <dt className={styles.dt}>직군</dt>
          <dd className={styles.dd}>{job.category.name}</dd>
        </div>
        <div className={styles.chip}>
          <dt className={styles.dt}>고용형태</dt>
          <dd className={styles.dd}>{EMPLOYMENT_LABEL[job.employmentType]}</dd>
        </div>
        <div className={styles.chip}>
          <dt className={styles.dt}>경력</dt>
          <dd className={styles.dd}>{CAREER_LABEL[job.careerLevel]}</dd>
        </div>
        <div className={`${styles.chip} ${styles.period}`}>
          <dt className={styles.dt}>모집 기간</dt>
          <dd className={styles.dd}>
            {formatDate(job.opensAt)} ~ {formatDate(job.closesAt)}
          </dd>
        </div>
        {job.dDayLabel !== null && (
          <div className={`${styles.chip} ${styles.dday}`}>
            <dt className={styles.dt}>마감</dt>
            <dd className={styles.dd}>
              {/* 마감 임박 시 시각적 강조는 CSS에 위임 — data-attr로 상태 노출 */}
              <span data-d-day={job.dDayLabel} aria-label={`마감 ${job.dDayLabel}`}>
                {job.dDayLabel}
              </span>
            </dd>
          </div>
        )}
        {job.isClosed && (
          <div className={`${styles.chip} ${styles.closed}`}>
            <dt className={styles.dt}>모집 상태</dt>
            <dd className={styles.dd}>지원 마감</dd>
          </div>
        )}
      </dl>
    </header>
  );
}
