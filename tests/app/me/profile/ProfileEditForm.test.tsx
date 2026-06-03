// CANDID-028 Step 3 — ProfileEditForm 에러 연관 회귀 테스트 (RTL, jsdom).
// 검증: 폼 레벨 메시지가 안정 id를 갖고 form aria-describedby로 연결(WCAG 3.3.1).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import { PROFILE_EDIT_LABELS as L } from '@/lib/users/profile-form';
import { ProfileEditForm } from '@/app/me/profile/_components/ProfileEditForm';

afterEach(() => {
  cleanup();
});

describe('ProfileEditForm 에러 연관', () => {
  it('변경 없음 제출 → 메시지 id + form aria-describedby 연결', async () => {
    render(<ProfileEditForm initialName="홍길동" phoneMasked={null} />);
    await userEvent.setup().click(screen.getByRole('button', { name: L.submit }));

    const msg = document.getElementById('profile-edit-msg');
    expect(msg).toHaveTextContent(L.noChange);
    expect(screen.getByRole('form')).toHaveAttribute('aria-describedby', 'profile-edit-msg');
  });
});
