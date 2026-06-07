import Link from 'next/link';
import type { JobStatus } from '@prisma/client';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import { CAREER_LABEL, EMPLOYMENT_LABEL } from '@/lib/jobs/labels';
import { listJobPostingsForAdmin } from '@/lib/admin/job-postings-list';
import { StatusControl } from './_components/StatusControl';
import styles from './job-postings.module.css';

// CANDID-053 Step 9 — 공고 관리 목록(전 상태). 운영자 전용 — 페이지 개별 가드(defense-in-depth).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<JobStatus, string> = {
  DRAFT: '임시저장',
  OPEN: '공개',
  CLOSED: '마감',
};

// CANDID-054 FR-004 — 넓어진 폭 활용: 마감일 컬럼. 상시 채용(closesAt null)은 '상시'로 표기.
const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });

interface PageProps {
  searchParams?: { page?: string };
}

export default async function AdminJobPostingsPage({ searchParams }: PageProps) {
  await requireOperatorPage('/admin/job-postings');
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const { items, pagination } = await listJobPostingsForAdmin(page);

  return (
    <main id="main-content" className={styles.content}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>공고 관리</h1>
        <Link href="/admin/job-postings/new" className={styles.primaryBtn}>
          + 새 공고
        </Link>
      </header>

      {items.length === 0 ? (
        <p className={styles.empty}>등록된 공고가 없습니다.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>제목</th>
              <th>직군</th>
              <th>형태/경력</th>
              <th>마감일</th>
              <th>상태</th>
              <th>지원</th>
              <th>상태 전환</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>{p.categoryName}</td>
                <td>
                  {EMPLOYMENT_LABEL[p.employmentType]} · {CAREER_LABEL[p.careerLevel]}
                </td>
                <td>{p.closesAt ? dateFmt.format(p.closesAt) : '상시'}</td>
                <td>
                  <span className={`${styles.badge} ${styles[`badge_${p.status}`]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td>
                  {/* 지원 카운트를 지원자 목록 링크로 — 거기서 각 지원서 상세(/admin/applications/{id})로 진입. */}
                  <Link
                    href={`/admin/job-postings/${p.id}/applicants`}
                    className={styles.link}
                    aria-label={`지원자 ${p.applicationCount}명 보기`}
                  >
                    {p.applicationCount}
                  </Link>
                </td>
                <td>
                  <StatusControl jobPostingId={p.id} current={p.status} />
                </td>
                <td>
                  <Link href={`/admin/job-postings/${p.id}/edit`} className={styles.link}>
                    수정
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className={styles.pager}>
        {pagination.page > 1 && (
          <Link href={`/admin/job-postings?page=${pagination.page - 1}`} className={styles.link}>
            ← 이전
          </Link>
        )}
        <span className={styles.pageInfo}>
          {pagination.page} / {pagination.totalPages} 페이지 · 총 {pagination.total}건
        </span>
        {pagination.hasMore && (
          <Link href={`/admin/job-postings?page=${pagination.page + 1}`} className={styles.link}>
            다음 →
          </Link>
        )}
      </footer>
    </main>
  );
}
