// CANDID-028 Step 4 — 실 컴포넌트 axe sweep (Step 1 리뷰 H004 종결).
// 파운데이션(Step 1~3)이 실제 폼/모달에서 WCAG 위반을 막는지 axe full 룰셋으로 증명한다.
// 페이지 스코프 룰(문서 1개 main/h1/title/lang)은 단편 렌더에 부적합하므로 비활성 —
// 컴포넌트 레벨 룰(label/aria/role/button-name 등)에 집중. color-contrast는 jsdom에서 자동 스킵.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { axe } from 'vitest-axe';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import { PersonalInfoStep } from '@/app/jobs/[id]/apply/_components/PersonalInfoStep';
import { ConfirmModal } from '@/app/me/withdraw/_components/ConfirmModal';
import { ProfileEditForm } from '@/app/me/profile/_components/ProfileEditForm';
import { PasswordChangeForm } from '@/app/me/profile/_components/PasswordChangeForm';
import { WithdrawForm } from '@/app/me/withdraw/_components/WithdrawForm';
import type { DraftPrefill } from '@/lib/drafts/types';

const AXE_OPTS = {
  rules: {
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    // jsdom은 레이아웃/캔버스 미지원이라 색대비 계산 불가 → Step 1 토큰 대비 단위테스트가 담당.
    'color-contrast': { enabled: false },
  },
};

const prefill: DraftPrefill = { email: 'a@b.com', name: '홍길동', phone: null, birthDate: null };

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('실 컴포넌트 axe sweep (WCAG)', () => {
  it.each<[string, () => React.JSX.Element]>([
    ['PersonalInfoStep', () => <PersonalInfoStep value={undefined} prefill={prefill} onChange={vi.fn()} />],
    ['ConfirmModal', () => <ConfirmModal onConfirm={vi.fn()} onCancel={vi.fn()} />],
    ['ProfileEditForm', () => <ProfileEditForm initialName="홍길동" phoneMasked={null} />],
    ['PasswordChangeForm', () => <PasswordChangeForm hasPassword={true} />],
    ['WithdrawForm(social-only)', () => <WithdrawForm isSocialOnly={true} />],
    ['WithdrawForm(password)', () => <WithdrawForm isSocialOnly={false} />],
  ])('%s — axe 위반 없음', async (_label, renderEl) => {
    const { container } = render(renderEl());
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });
});
