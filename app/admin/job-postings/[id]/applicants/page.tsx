import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StageType } from '@prisma/client';
import { isAppError } from '@/lib/errors';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import { listApplicantsByPosting } from '@/lib/admin/applicants';
import { resultLabel, stageLabel } from '@/lib/my-page/stage-labels';
import styles from '../../job-postings.module.css';

// CANDID-053 Step 11 — 공고별 지원자 목록(마스킹). 운영자 전용 — 페이지 개별 가드(defense-in-depth).
//   이름/이메일은 마스킹된 값만(평문 PII는 상세 페이지의 명시 열람에서만, PII_VIEW 감사).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGE_FILTERS = Object.values(StageType);

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
  try {
    data = await listApplicantsByPosting({ jobPostingId, page, stage });
  } catch (err) {
    if (isAppError(err) && err.code === 'JOB_NOT_FOUND') {
      notFound();
    }
    throw err;
  }
  const { items, pagination } = data;
  const base = `/admin/job-postings/${jobPostingId}/applicants`;

  return (
    <main id="main-content" className={styles.content}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>지원자 목록</h1>
        <Link href="/admin/job-postings" className={styles.link}>
          ← 공고 목록
        </Link>
      </header>

      <nav className={styles.pager} aria-label="전형 단계 필터">
        <Link href={base} className={styles.link}>
          전체
        </Link>
        {STAGE_FILTERS.map((s) => (
          <Link key={s} href={`${base}?stage=${s}`} className={styles.link}>
            {stageLabel(s)}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className={styles.empty}>해당 조건의 지원자가 없습니다.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>지원번호</th>
              <th>이름</th>
              <th>이메일</th>
              <th>전형 단계</th>
              <th>결과</th>
              <th></th>
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
                  <Link href={`/admin/applications/${a.applicationId}`} className={styles.link}>
                    상세
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className={styles.pager}>
        {pagination.page > 1 && (
          <Link
            href={`${base}?page=${pagination.page - 1}${stage ? `&stage=${stage}` : ''}`}
            className={styles.link}
          >
            ← 이전
          </Link>
        )}
        <span className={styles.pageInfo}>
          {pagination.page} / {pagination.totalPages} 페이지 · 총 {pagination.total}명
        </span>
        {pagination.hasMore && (
          <Link
            href={`${base}?page=${pagination.page + 1}${stage ? `&stage=${stage}` : ''}`}
            className={styles.link}
          >
            다음 →
          </Link>
        )}
      </footer>
    </main>
  );
}
