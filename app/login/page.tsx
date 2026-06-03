// CANDID-050 Step 2 — 로그인 페이지 (RSC, US-AUTH-002).
// ?redirect를 서버에서 sanitize(open-redirect 가드)해 LoginForm에 안전 경로로 전달한다.
// 이미 로그인 상태면 폼을 보이지 않고 안전 경로로 즉시 이동.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { safeInternalPath } from '@/lib/auth/redirect';
import { LoginForm } from '@/app/login/_components/LoginForm';

export const metadata: Metadata = {
  title: '로그인',
  description: '자사 채용 사이트 로그인',
  robots: { index: false, follow: true }, // 인증 페이지는 noindex, 단 내부 링크 크롤은 허용
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const safeRedirect = safeInternalPath(firstParam(sp.redirect));

  // 이미 로그인 → 폼 노출 없이 목적지로.
  const auth = await getOptionalAuthFromCookies();
  if (auth !== null) redirect(safeRedirect);

  return (
    <main id="main-content">
      <h1>로그인</h1>
      <LoginForm redirectTo={safeRedirect} />
    </main>
  );
}
