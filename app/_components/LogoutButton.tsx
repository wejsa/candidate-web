'use client';

// CANDID-050 Step 2 — 로그아웃 버튼 (Client).
// POST /api/v1/auth/logout(멱등) → 쿠키 클리어 후 홈으로 이동 + 서버 컴포넌트 갱신.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/app/_components/SiteHeader.module.css';

export function LogoutButton(): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout(): Promise<void> {
    setPending(true);
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // 멱등 — 네트워크 실패여도 클라이언트는 홈으로 보내 UI 상태를 초기화.
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <button type="button" className={styles.logout} onClick={() => void logout()} disabled={pending}>
      {pending ? '로그아웃 중…' : '로그아웃'}
    </button>
  );
}
