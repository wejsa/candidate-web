// CANDID-020 Step 3 — /password/reset-request 페이지 RSC (US-AUTH-004).
//
// 비인증 페이지 (비밀번호를 잊은 사용자). 인증 체크 없음.
// 색인 제외(noindex) — 계정/인증 관련 페이지.
// 실제 요청 처리는 Client Component(ResetRequestForm) → POST /api/v1/auth/password/reset-request.

import type { Metadata } from 'next';
import { ResetRequestForm } from '@/app/password/reset-request/_components/ResetRequestForm';

export const metadata: Metadata = {
  title: '비밀번호 재설정 | Candidate Web',
  description: '가입한 이메일로 비밀번호 재설정 안내를 받으세요.',
  robots: { index: false, follow: false }, // 인증 관련 페이지 — 색인 제외
};

export default function ResetRequestPage(): React.JSX.Element {
  return (
    <main id="main-content" aria-labelledby="reset-request-page-title">
      <header>
        <h1 id="reset-request-page-title">비밀번호를 잊으셨나요?</h1>
      </header>
      <ResetRequestForm />
    </main>
  );
}
