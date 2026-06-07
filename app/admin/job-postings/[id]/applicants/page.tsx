import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StageType, ApplicationResult } from '@prisma/client';
import { isAppError } from '@/lib/errors';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import {
  listApplicantsByPosting,
  getApplicantStatsByPosting,
  OPERATOR_DASHBOARD_PER_PAGE,
} from '@/lib/admin/applicants';
import { resultLabel, stageLabel } from '@/lib/my-page/stage-labels';
import jp from '../../job-postings.module.css';
import styles from '../../applicants.module.css';

// CANDID-053 Step 11 / CANDID-054 FR-002 — 공고별 지원자 대시보드(마스킹 + KPI 분포 + 카운트 칩 필터).
//   이름/이메일은 마스킹된 값만(평문 PII는 상세 페이지의 명시 열람에서만, PII_VIEW 감사).
//   KPI/분포는 카운트만 산출(PII 미접촉). 목록과 집계를 병렬 조회.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGE_FILTERS = Object.values(StageType);
// 결과 KPI는 enum에서 동적 생성(SSOT) — 신규 결과 값 추가 시 자동 반영. 선언 순서(진행 → 종단)가 곧 표시 순서.
const RESULT_ORDER = Object.values(ApplicationResult);

interface PageProps {
  params: { id: string };
  searchParams?: { page?: string; stage?: string };
}

export default async function PostingApplicantsPage({ params, searchParams }: PageProps) {
  await requireOperatorPage(`/admin/job-postings/${params.id}/applicants`);
  const jobPostingId = Number(params.id);
  if (!Number.isInteger(jobPostingId) || jobPostingId <= 0) {
    notFound();
  }
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const stageParam = searchParams?.stage;
  const stage = STAGE_FILTERS.includes(stageParam as StageType)
    ? (stageParam as StageType)
    : undefined;

  let data;
  let stats;
  try {
    // 공고 존재 검증은 목록 조회가 담당(JOB_NOT_FOUND) → 집계와 병렬.
    [data, stats] = await Promise.all([
      listApplicantsByPosting({ jobPostingId, page, stage, perPage: OPERATOR_DASHBOARD_PER_PAGE }),
      getApplicantStatsByPosting(jobPostingId),
    ]);
  } catch (err) {
    if (isAppError(err) && err.code === 'JOB_NOT_FOUND') {
      notFound();
    }
    throw err;
  }
  const { items, pagination } = data;
  const base = `/admin/job-postings/${jobPostingId}/applicants`;

  return (
    <main id="main-content" className={jp.content}>
      <header className={jp.pageHead}>
        <h1 className={jp.pageTitle}>지원자 대시보드</h1>
        <Link href="/admin/job-postings" className={jp.link}>
          ← 공고 목록
        </Link>
      </header>

      {/* ── KPI: 총계 + 전형 단계별 ─────────────────────────── */}
      <section className={styles.kpiSection} aria-label="전형 단계별 지원 분포">
        <p className={styles.kpiGroupLabel}>전형 단계</p>
        <div className={styles.kpiGrid}>
          <div className={`${styles.kpiCard} ${styles.kpiTotal}`}>
            <span className={styles.kpiValue}>{stats.total}</span>
            <span className={styles.kpiLabel}>총 지원</span>
          </div>
          {STAGE_FILTERS.map((s) => (
            <div key={s} className={styles.kpiCard}>
              <span className={styles.kpiValue}>{stats.byStage[s]}</span>
              <span className={styles.kpiLabel}>{stageLabel(s)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── KPI: 결과별 ─────────────────────────────────────── */}
      <section className={styles.kpiSection} aria-label="결과별 지원 분포">
        <p className={styles.kpiGroupLabel}>결과</p>
        <div className={styles.kpiGrid}>
          {RESULT_ORDER.map((r) => (
            <div key={r} className={styles.kpiCard}>
              <span className={styles.kpiValue}>{stats.byResult[r]}</span>
              <span className={styles.kpiLabel}>{resultLabel(r)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── 카운트 칩 필터 ──────────────────────────────────── */}
      <nav className={styles.chipRow} aria-label="전형 단계 필터">
        <Link
          href={base}
          className={`${styles.chip} ${stage === undefined ? styles.chipActive : ''}`}
          aria-current={stage === undefined ? 'page' : undefined}
        >
          전체 <span className={styles.chipCount}>{stats.total}</span>
        </Link>
        {STAGE_FILTERS.map((s) => (
          <Link
            key={s}
            href={`${base}?stage=${s}`}
            className={`${styles.chip} ${stage === s ? styles.chipActive : ''}`}
            aria-current={stage === s ? 'page' : undefined}
          >
            {stageLabel(s)} <span className={styles.chipCount}>{stats.byStage[s]}</span>
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className={jp.empty}>해당 조건의 지원자가 없습니다.</p>
      ) : (
        <table className={jp.table}>
          <thead>
            <tr>
              <th>지원번호</th>
              <th>이름</th>
              <th>이메일</th>
              <th>전형 단계</th>
              <th>결과</th>
              <th>상세</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.applicationId}>
                <td>{a.applicationNumber}</td>
                <td>{a.applicantNameMasked}</td>
                <td>{a.applicantEmailMasked}</td>
                <td>{stageLabel(a.currentStage)}</td>
                <td>{resultLabel(a.result)}</td>
                <td>
                  <Link href={`/admin/applications/${a.applicationId}`} className={jp.link}>
                    상세
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className={jp.pager}>
        {pagination.page > 1 && (
          <Link
            href={`${base}?page=${pagination.page - 1}${stage ? `&stage=${stage}` : ''}`}
            className={jp.link}
          >
            ← 이전
          </Link>
        )}
        <span className={jp.pageInfo}>
          {pagination.page} / {pagination.totalPages} 페이지 · 총 {pagination.total}명
        </span>
        {pagination.hasMore && (
          <Link
            href={`${base}?page=${pagination.page + 1}${stage ? `&stage=${stage}` : ''}`}
            className={jp.link}
          >
            다음 →
          </Link>
        )}
      </footer>
    </main>
  );
}
