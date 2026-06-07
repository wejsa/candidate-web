// CANDID-050 Step 2 — 전역 헤더/네비게이션 (RSC).
// 인증 상태(getOptionalAuthFromCookies)에 따라 우측 영역 분기:
//   비로그인 → 로그인 / 회원가입, 로그인 → 마이페이지 / 로그아웃.
// 로고·"채용 공고"는 항상 노출. skip-link 다음, <main> 앞에 위치(layout).

import Link from 'next/link';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { getOperatorRole } from '@/lib/auth/require-role-page';
import { LogoutButton } from '@/app/_components/LogoutButton';
import { HojiLogo } from '@/app/_components/HojiLogo';
import styles from '@/app/_components/SiteHeader.module.css';

export async function SiteHeader(): Promise<React.JSX.Element> {
  const auth = await getOptionalAuthFromCookies();
  // UI 표시 전용 — 보호 리소스 접근 제어(인가)는 미들웨어/페이지 가드가 담당.
  // 이 값을 라우트 보호 판단에 재사용하지 말 것.
  const isAuthed = auth !== null;
  // 운영자(RECRUITER/ADMIN)면 "관리자" 메뉴 노출. 표시 전용 — 실제 접근 제어는 백오피스 페이지 가드.
  const operatorRole = auth !== null ? await getOperatorRole(auth.userId) : null;

  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="주요">
        <Link href="/" className={styles.brand} aria-label="Hoji Careers 홈">
          <HojiLogo />
        </Link>
        <Link href="/jobs" className={styles.navLink}>
          채용 공고
        </Link>
        <span className={styles.spacer} />
        {operatorRole !== null && (
          <Link href="/admin" className={styles.navLink}>
            관리자
          </Link>
        )}
        {isAuthed ? (
          <>
            <Link href="/me" className={styles.navLink}>
              마이페이지
            </Link>
            <LogoutButton />
          </>
        ) : (
          <>
            <Link href="/login" className={styles.navLink}>
              로그인
            </Link>
            <Link href="/signup" className={styles.navCta}>
              회원가입
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
