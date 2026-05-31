// CANDID-024 Step 1 — 프로필 읽기전용 표시 (US-MY-004).
//
// 서버 컴포넌트 (상호작용 없음). 수정/비번/소셜 관리 UI는 Step 2~4에서 추가된다.
// 평문 PII는 props로 전달되지 않는다 — phoneMasked(마스킹) / hasPassword(boolean)만 받는다.

import type { ProfileDto, ProfileProviderName } from '@/lib/users/types';

const PROVIDER_LABELS: Record<ProfileProviderName, string> = {
  google: 'Google',
  github: 'GitHub',
};

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

      <h2 id="profile-providers-title">연결된 소셜 계정</h2>
      {profile.providers.length === 0 ? (
        <p>연결된 소셜 계정이 없습니다.</p>
      ) : (
        <ul aria-labelledby="profile-providers-title">
          {profile.providers.map((p) => (
            <li key={p.provider}>
              {PROVIDER_LABELS[p.provider]}
              <span> · 연결일 </span>
              <time dateTime={p.linkedAt}>{p.linkedAt.slice(0, 10)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
