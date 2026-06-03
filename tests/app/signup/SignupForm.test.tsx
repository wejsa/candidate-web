// CANDID-050 Step 2 — SignupForm 컴포넌트 테스트 (RTL, jsdom).
// 검증: 성공(201) 시 이메일 인증 안내 화면, 중복 이메일(409) 메시지, 비밀번호 불일치/약관 미동의 클라 가드.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

import { SignupForm } from '@/app/signup/_components/SignupForm';

function mockFetch(status: number, body: unknown = {}): Mock {
  const fn = vi.fn(async () => ({ status, json: async () => body })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function fillBasics(
  user: ReturnType<typeof userEvent.setup>,
  { pw = 'Passw0rd!@#', confirm = 'Passw0rd!@#' }: { pw?: string; confirm?: string } = {},
): Promise<void> {
  await user.type(screen.getByLabelText('이메일'), 'a@b.com');
  await user.type(screen.getByLabelText('이름'), '홍길동');
  await user.type(screen.getByLabelText('비밀번호'), pw);
  await user.type(screen.getByLabelText('비밀번호 확인'), confirm);
}

async function checkRequiredAgreements(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByLabelText(/서비스 이용약관/));
  await user.click(screen.getByLabelText(/개인정보 처리방침/));
  await user.click(screen.getByLabelText(/만 14세 이상/));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SignupForm', () => {
  it('성공(201) → 이메일 인증 안내 화면', async () => {
    mockFetch(201, { user: { id: 10 }, verificationEmailQueued: true });
    const user = userEvent.setup();
    render(<SignupForm redirectTo="/me" />);
    await fillBasics(user);
    await checkRequiredAgreements(user);
    await user.click(screen.getByRole('button', { name: '가입하기' }));

    await waitFor(() => expect(screen.getByText('가입이 완료되었습니다')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('인증 메일');
    expect(screen.getByRole('link', { name: '계속하기' })).toHaveAttribute('href', '/me');
  });

  it('409 USER_EMAIL_DUPLICATED → 중복 이메일 메시지', async () => {
    mockFetch(409, { code: 'USER_EMAIL_DUPLICATED' });
    const user = userEvent.setup();
    render(<SignupForm redirectTo="/me" />);
    await fillBasics(user);
    await checkRequiredAgreements(user);
    await user.click(screen.getByRole('button', { name: '가입하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 가입된 이메일');
  });

  it('비밀번호 불일치 → 제출 없이 클라 가드', async () => {
    const fetchMock = mockFetch(201);
    const user = userEvent.setup();
    render(<SignupForm redirectTo="/me" />);
    await fillBasics(user, { confirm: 'different!' });
    await checkRequiredAgreements(user);
    await user.click(screen.getByRole('button', { name: '가입하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('일치하지 않습니다');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('필수 약관 미동의 → 제출 없이 클라 가드', async () => {
    const fetchMock = mockFetch(201);
    const user = userEvent.setup();
    render(<SignupForm redirectTo="/me" />);
    await fillBasics(user);
    // 약관 체크 생략
    await user.click(screen.getByRole('button', { name: '가입하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('동의');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
