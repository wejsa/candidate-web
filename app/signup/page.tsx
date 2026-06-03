// CANDID-050 Step 2 — 회원가입 페이지 (RSC, US-AUTH-001).
// ?redirect를 sanitize해 가입 완료(이메일 인증 안내) 후 이동 경로로 SignupForm에 전달.
// 이미 로그인 상태면 안전 경로로 즉시 이동.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { safeInternalPath } from '@/lib/auth/redirect';
import { SignupForm } from '@/app/signup/_components/SignupForm';

export const metadata: Metadata = {
  title: '회원가입',
  description: '자사 채용 사이트 회원가입',
  robots: { index: false, follow: true }, // 인증 페이지는 noindex, 단 내부 링크 크롤은 허용
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SignupPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const safeRedirect = safeInternalPath(firstParam(sp.redirect));

  const auth = await getOptionalAuthFromCookies();
  if (auth !== null) redirect(safeRedirect);

  return (
    <main id="main-content">
      <h1>회원가입</h1>
      <SignupForm redirectTo={safeRedirect} />
    </main>
  );
}
