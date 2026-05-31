// CANDID-024 Step 1 — 프로필 읽기전용 표시 (US-MY-004).
//
// 서버 컴포넌트 (상호작용 없음). 계정 기본 정보만 표시한다.
// 소셜 계정 목록/관리는 Step 4 SocialAccountsSection(클라이언트)로 분리됐다.
// 평문 PII는 props로 전달되지 않는다 — phoneMasked(마스킹) / hasPassword(boolean)만 받는다.

import type { ProfileDto } from '@/lib/users/types';

interface ProfileViewProps {
  profile: ProfileDto;
}

export function ProfileView({ profile }: ProfileViewProps) {
  return (
    <section aria-labelledby="profile-account-title">
      <h2 id="profile-account-title">계정 정보</h2>
      <dl>
        <dt>이름</dt>
        <dd>{profile.name}</dd>
        <dt>이메일</dt>
        <dd>{profile.email}</dd>
        <dt>연락처</dt>
        <dd>{profile.phoneMasked ?? '미등록'}</dd>
        <dt>비밀번호</dt>
        <dd>{profile.hasPassword ? '설정됨' : '미설정 (소셜 로그인 전용)'}</dd>
      </dl>
    </section>
  );
}
