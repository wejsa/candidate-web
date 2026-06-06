import Link from 'next/link';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import { listJobCategoryOptions } from '@/lib/admin/job-postings-list';
import { JobPostingForm } from '../_components/JobPostingForm';
import styles from '../job-postings.module.css';

// CANDID-053 Step 9 — 새 공고 작성. 생성은 항상 DRAFT(노출은 목록의 상태 전환).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function NewJobPostingPage() {
  await requireOperatorPage('/admin/job-postings/new');
  const categories = await listJobCategoryOptions();

  return (
    <main id="main-content" className={styles.content}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>새 공고</h1>
        <Link href="/admin/job-postings" className={styles.link}>
          ← 목록
        </Link>
      </header>
      <JobPostingForm mode="create" categories={categories} />
    </main>
  );
}
