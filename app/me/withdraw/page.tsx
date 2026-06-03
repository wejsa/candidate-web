// CANDID-022 Step 4 — /me/withdraw 페이지 RSC (US-AUTH-005).
//
// 인증 필수 — 비로그인 → /login?redirect=/me/withdraw.
// 이미 탈퇴된 사용자(anonymizedAt NOT NULL 또는 status WITHDRAWN) → /me로 redirect (멱등).
// 비밀번호 보유 사용자만 폼 활성 — 소셜 전용은 안내 메시지로 차단.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { prisma } from '@/lib/prisma';
import { WITHDRAW_LABELS } from '@/lib/users/labels';
import { WithdrawForm } from '@/app/me/withdraw/_components/WithdrawForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: WITHDRAW_LABELS.pageTitle,
  description: WITHDRAW_LABELS.pageDescription,
  robots: { index: false, follow: false }, // 인증 페이지 — 색인 제외
};

export default async function WithdrawPage() {
  const auth = await getOptionalAuthFromCookies();
  if (auth === null) {
    redirect(`/login?redirect=${encodeURIComponent('/me/withdraw')}`);
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { passwordHash: true, anonymizedAt: true, status: true },
  });
  if (user === null || user.anonymizedAt !== null || user.status === 'WITHDRAWN') {
    // 이미 탈퇴됨 또는 사용자 미존재 — 멱등 처리
    redirect('/me');
  }

  const isSocialOnly = user.passwordHash === null;

  return (
    <main id="main-content" aria-labelledby="withdraw-title">
      <header>
        <h1 id="withdraw-title">{WITHDRAW_LABELS.pageTitle}</h1>
        <p>{WITHDRAW_LABELS.pageDescription}</p>
      </header>

      <section aria-labelledby="withdraw-notice-title">
        <h2 id="withdraw-notice-title">{WITHDRAW_LABELS.noticeHeading}</h2>
        <ul>
          <li>{WITHDRAW_LABELS.noticeAnonymizedBranch}</li>
          <li>{WITHDRAW_LABELS.noticeHardDeleteBranch}</li>
          <li>{WITHDRAW_LABELS.noticeRefreshTokenRevoke}</li>
          <li>
            <strong>{WITHDRAW_LABELS.noticeIrreversible}</strong>
          </li>
        </ul>
      </section>

      <WithdrawForm isSocialOnly={isSocialOnly} />
    </main>
  );
}
