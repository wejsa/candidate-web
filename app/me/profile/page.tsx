// CANDID-024 Step 1 — 프로필 페이지 RSC (US-MY-004).
//
// 인증 필수 — 비로그인은 /login?redirect=/me/profile로 redirect (app/me/page.tsx 패턴).
// getProfile 서비스를 서버에서 직접 호출 (GET /api/v1/users/me는 클라이언트 갱신용).
// 인증 페이지이므로 robots 색인 제외.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { getProfile } from '@/lib/users/profile-service';
import { ProfileView } from '@/app/me/profile/_components/ProfileView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '프로필',
  description: '내 계정 정보를 확인하고 수정합니다.',
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const auth = await getOptionalAuthFromCookies();
  if (auth === null) {
    redirect(`/login?redirect=${encodeURIComponent('/me/profile')}`);
  }

  const profile = await getProfile(auth.userId);

  return (
    <main>
      <h1>프로필</h1>
      <ProfileView profile={profile} />
    </main>
  );
}
