// CANDID-024 Step 1 — 프로필 페이지 RSC (US-MY-004).
//
// 인증 필수 — 비로그인은 /login?redirect=/me/profile로 redirect (app/me/page.tsx 패턴).
// getProfile 서비스를 서버에서 직접 호출 (GET /api/v1/users/me는 클라이언트 갱신용).
// 인증 페이지이므로 robots 색인 제외.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOptionalAuthFromCookies } from '@/lib/auth/server-cookies';
import { getProfile } from '@/lib/users/profile-service';
import { ProfileView } from '@/app/me/profile/_components/ProfileView';
import { EmailVerificationSection } from '@/app/me/profile/_components/EmailVerificationSection';
import { ProfileEditForm } from '@/app/me/profile/_components/ProfileEditForm';
import { PasswordChangeForm } from '@/app/me/profile/_components/PasswordChangeForm';
import { SocialAccountsSection } from '@/app/me/profile/_components/SocialAccountsSection';
import { AppError } from '@/lib/errors';
import type { ProfileDto } from '@/lib/users/types';
import styles from '@/app/me/profile/profile.module.css';

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
    <main id="main-content" className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>프로필</h1>
        <p className={styles.heroSubtitle}>계정 정보를 확인하고 수정합니다.</p>
      </header>
      <ProfileView profile={profile} />
      <EmailVerificationSection
        emailVerified={profile.emailVerified}
        email={profile.email}
        devMode={process.env.NODE_ENV !== 'production'}
      />
      <ProfileEditForm
        initialName={profile.name}
        phoneMasked={profile.phoneMasked}
        birthDateMasked={profile.birthDateMasked}
      />
      <PasswordChangeForm hasPassword={profile.hasPassword} />
      <SocialAccountsSection providers={profile.providers} />
      {/* 회원 탈퇴 진입 — destructive 액션이라 하단에 muted로 배치(/me/withdraw). */}
      <div className={styles.dangerZone}>
        <Link href="/me/withdraw" className={styles.withdrawLink}>
          회원 탈퇴
        </Link>
      </div>
    </main>
  );
}
