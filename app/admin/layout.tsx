import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireOperatorPage } from '@/lib/auth/require-role-page';
import styles from './admin.module.css';

// CANDID-053 Step 8 — 백오피스 셸(RSC). 모든 /admin/** 의 공통 레이아웃 + 1차 역할 가드.
//   보안 경계는 각 페이지의 requireOperatorPage가 책임지며, 본 레이아웃 가드는 보조(셸 비노출).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '백오피스',
  description: '채용 운영 백오피스',
  robots: { index: false, follow: false }, // 운영 화면 — 색인 제외
};

const NAV_ITEMS = [
  { href: '/admin', label: '대시보드' },
  { href: '/admin/job-postings', label: '공고 관리' },
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { role } = await requireOperatorPage();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="백오피스 메뉴">
        <p className={styles.brand}>백오피스</p>
        <nav className={styles.sideNav}>
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={styles.sideLink}>
              {item.label}
            </Link>
          ))}
        </nav>
        <span className={styles.roleBadge} aria-label="현재 권한">
          {role}
        </span>
      </aside>
      {children}
    </div>
  );
}
