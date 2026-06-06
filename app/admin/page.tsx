import Link from 'next/link';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import styles from './admin.module.css';

// CANDID-053 Step 8 — 백오피스 대시보드 홈. 운영 작업 진입점 카드.
//   레이아웃이 셸 가드를 수행하지만, 페이지도 데이터/표시 직전 가드를 재호출(defense-in-depth).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTRY_CARDS = [
  {
    href: '/admin/job-postings',
    title: '공고 관리',
    desc: '채용 공고를 생성·수정하고 모집 상태를 전환합니다.',
  },
] as const;

export default async function AdminHomePage() {
  const { role } = await requireOperatorPage();

  return (
    <main id="main-content" className={styles.content}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>운영 대시보드</h1>
        <p className={styles.pageSubtitle}>
          {role} 권한으로 로그인했습니다. 작업할 영역을 선택하세요.
        </p>
      </header>

      <ul className={styles.cardGrid}>
        {ENTRY_CARDS.map((card) => (
          <li key={card.href}>
            <Link href={card.href} className={styles.entryCard}>
              <span className={styles.entryTitle}>{card.title}</span>
              <span className={styles.entryDesc}>{card.desc}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
