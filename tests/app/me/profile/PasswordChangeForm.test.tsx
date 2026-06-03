// CANDID-028 Step 3 — PasswordChangeForm 에러 연관 회귀 테스트 (RTL, jsdom).
// 검증: 확인 불일치 시 confirm input이 aria-invalid + aria-describedby로 메시지에 연결(WCAG 3.3.1).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PASSWORD_CHANGE_LABELS as L } from '@/lib/users/profile-form';
import { PasswordChangeForm } from '@/app/me/profile/_components/PasswordChangeForm';

afterEach(() => {
  cleanup();
});

describe('PasswordChangeForm 에러 연관', () => {
  it('새/확인 불일치 → confirm aria-invalid + 메시지 연관', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeForm hasPassword={false} />);

    await user.type(screen.getByLabelText(L.newLabel), 'NewPassw0rd!');
    await user.type(screen.getByLabelText(L.confirmLabel), 'Different0rd!');
    await user.click(screen.getByRole('button', { name: L.submit }));

    const confirm = screen.getByLabelText(L.confirmLabel);
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(confirm).toHaveAttribute('aria-describedby', 'password-change-msg');
    expect(document.getElementById('password-change-msg')).toHaveTextContent(L.errorMismatch);
  });
});
