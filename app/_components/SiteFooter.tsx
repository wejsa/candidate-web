// P1-5 — 전역 푸터 (RSC). layout의 <main> 뒤에 위치.
// 존재하는 라우트만 링크로, 미구현 항목은 비링크 텍스트로(데드링크/a11y 회피).
import Link from 'next/link';
import { HojiLogo } from '@/app/_components/HojiLogo';
import styles from '@/app/_components/SiteFooter.module.css';

const YEAR = new Date().getFullYear();

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className={styles.footer} aria-label="사이트 푸터">
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <HojiLogo height={24} />
          <p className={styles.tagline}>무인 환전·결제 플랫폼을 만드는 사람들.</p>
        </div>

        <nav className={styles.cols} aria-label="푸터">
          <div className={styles.col}>
            <h2 className={styles.colTitle}>채용</h2>
            <Link href="/jobs" className={styles.link}>
              채용 공고
            </Link>
            <Link href="/login" className={styles.link}>
              로그인
            </Link>
            <Link href="/signup" className={styles.link}>
              회원가입
            </Link>
          </div>
          <div className={styles.col}>
            <h2 className={styles.colTitle}>회사</h2>
            <span className={styles.muted}>회사 소개 (준비 중)</span>
            <span className={styles.muted}>팀 블로그 (준비 중)</span>
          </div>
          <div className={styles.col}>
            <h2 className={styles.colTitle}>정책</h2>
            <span className={styles.muted}>개인정보처리방침 (준비 중)</span>
            <span className={styles.muted}>이용약관 (준비 중)</span>
          </div>
        </nav>
      </div>

      <div className={styles.bottom}>
        <div className={styles.bottomInner}>
          <span>© {YEAR} Hoji. All rights reserved.</span>
          <span>본 사이트는 채용 프로토타입입니다.</span>
        </div>
      </div>
    </footer>
  );
}
