// CANDID-020 Step 5 — /password/reset 페이지 RSC (US-AUTH-004).
//
// 비인증 페이지. 쿼리스트링 token(?token=...)을 추출해 Client Component(ResetForm)로 전달.
// 색인 제외(noindex) — 인증 관련 일회성 링크.

import type { Metadata } from 'next';
import { ResetForm } from '@/app/password/reset/_components/ResetForm';

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export const metadata: Metadata = {
  title: '새 비밀번호 설정 | Candidate Web',
  description: '비밀번호 재설정 링크로 새 비밀번호를 설정하세요.',
  robots: { index: false, follow: false }, // 인증 관련 페이지 — 색인 제외
  referrer: 'no-referrer', // 쿼리스트링 토큰이 외부 요청 Referer로 누출되지 않도록 차단
};

export default function ResetPage({ searchParams }: PageProps): React.JSX.Element {
  const raw = searchParams.token;
  const token = typeof raw === 'string' ? raw : '';

  return (
    <main aria-labelledby="reset-page-title">
      <header>
        <h1 id="reset-page-title">비밀번호 재설정</h1>
      </header>
      <ResetForm token={token} />
    </main>
  );
}
