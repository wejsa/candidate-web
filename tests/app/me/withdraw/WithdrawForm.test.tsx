// CANDID-028 Step 3 — WithdrawForm 에러 연관 회귀 테스트 (RTL, jsdom).
// 검증: 비밀번호 오류(401) 시 password input이 aria-invalid + aria-describedby로 에러에 연결(WCAG 3.3.1).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { WITHDRAW_LABELS as L } from '@/lib/users/labels';
import { WithdrawForm } from '@/app/me/withdraw/_components/WithdrawForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WithdrawForm 에러 연관', () => {
  it('비밀번호 불일치(401) → password aria-invalid + aria-describedby 연결', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) })),
    );
    const user = userEvent.setup();
    render(<WithdrawForm isSocialOnly={false} />);

    await user.type(screen.getByLabelText(L.passwordFieldLabel), 'wrong-password');
    await user.click(screen.getByRole('button', { name: L.submitButton }));
    await user.click(screen.getByRole('button', { name: L.modalConfirmButton }));

    expect(await screen.findByText(L.errorPasswordMismatch)).toBeInTheDocument();
    const pw = screen.getByLabelText(L.passwordFieldLabel);
    expect(pw).toHaveAttribute('aria-invalid', 'true');
    expect(pw).toHaveAttribute('aria-describedby', 'withdraw-form-error');
    expect(document.getElementById('withdraw-form-error')).toHaveTextContent(L.errorPasswordMismatch);
  });
});
