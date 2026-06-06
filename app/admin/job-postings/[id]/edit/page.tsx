import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAppError } from '@/lib/errors';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import {
  getJobPostingForEdit,
  listJobCategoryOptions,
} from '@/lib/admin/job-postings-list';
import { JobPostingForm } from '../../_components/JobPostingForm';
import styles from '../../job-postings.module.css';

// CANDID-053 Step 10 — 공고 수정. 내용 편집(상태 전이는 목록 StatusControl).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Date → datetime-local 프리필("YYYY-MM-DDTHH:mm", UTC) — 폼 submit의 UTC 해석과 정합. */
function toLocalInput(date: Date | null): string {
  return date === null ? '' : date.toISOString().slice(0, 16);
}

interface PageProps {
  params: { id: string };
}

export default async function EditJobPostingPage({ params }: PageProps) {
  await requireOperatorPage(`/admin/job-postings/${params.id}/edit`);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  let posting;
  try {
    posting = await getJobPostingForEdit(id);
  } catch (err) {
    if (isAppError(err) && err.code === 'JOB_NOT_FOUND') {
      notFound();
    }
    throw err;
  }
  const categories = await listJobCategoryOptions();

  return (
    <main id="main-content" className={styles.content}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>공고 수정</h1>
        <Link href="/admin/job-postings" className={styles.link}>
          ← 목록
        </Link>
      </header>
      <JobPostingForm
        mode="edit"
        categories={categories}
        initial={{
          id: posting.id,
          title: posting.title,
          jobCategoryId: posting.jobCategoryId,
          employmentType: posting.employmentType,
          careerLevel: posting.careerLevel,
          contentHtml: posting.contentHtml,
          opensAtLocal: toLocalInput(posting.opensAt),
          closesAtLocal: toLocalInput(posting.closesAt),
        }}
      />
    </main>
  );
}
