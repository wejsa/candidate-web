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
import { ProfileEditForm } from '@/app/me/profile/_components/ProfileEditForm';
import { PasswordChangeForm } from '@/app/me/profile/_components/PasswordChangeForm';
import { AppError } from '@/lib/errors';
import type { ProfileDto } from '@/lib/users/types';

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

  // 토큰은 유효하지만 계정이 탈퇴/삭제된 엣지(토큰 만료 전 탈퇴) → 모호한 에러 화면 대신 로그인 유도.
  let profile: ProfileDto;
  try {
    profile = await getProfile(auth.userId);
  } catch (e) {
    if (e instanceof AppError && e.code === 'USER_NOT_FOUND') {
      redirect(`/login?redirect=${encodeURIComponent('/me/profile')}`);
    }
    throw e;
  }

  return (
    <main>
      <h1>프로필</h1>
      <ProfileView profile={profile} />
      <ProfileEditForm initialName={profile.name} phoneMasked={profile.phoneMasked} />
      <PasswordChangeForm hasPassword={profile.hasPassword} />
    </main>
  );
}
