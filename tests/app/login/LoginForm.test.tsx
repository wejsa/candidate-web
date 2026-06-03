// CANDID-050 Step 2 — LoginForm 컴포넌트 테스트 (RTL, jsdom).
// 검증: 성공 시 redirectTo로 router.replace + refresh, 에러코드별 메시지, 소셜/회원가입 링크의 redirect 보존.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));

import { LoginForm } from '@/app/login/_components/LoginForm';

function mockFetch(status: number, body: unknown = {}): Mock {
  const fn = vi.fn(async () => ({ status, json: async () => body })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function fill(email = 'a@b.com', password = 'Passw0rd!@#'): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('이메일'), email);
  await user.type(screen.getByLabelText('비밀번호'), password);
  await user.click(screen.getByRole('button', { name: '로그인' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
  refresh.mockReset();
});

describe('LoginForm', () => {
  it('성공(200) → redirectTo로 replace 먼저, refresh 나중(순서 보장)', async () => {
    const order: string[] = [];
    replace.mockImplementation(() => void order.push('replace'));
    refresh.mockImplementation(() => void order.push('refresh'));
    mockFetch(200, { user: { id: 1 } });
    render(<LoginForm redirectTo="/jobs/6/apply" />);
    await fill();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/jobs/6/apply'));
    // replace가 refresh보다 먼저 — 역순이면 목적지에서 헤더 인증 상태가 갱신 안 됨.
    expect(order).toEqual(['replace', 'refresh']);
  });

  it('403 AUTH_EMAIL_NOT_VERIFIED → 이메일 인증 안내 메시지', async () => {
    mockFetch(403, { code: 'AUTH_EMAIL_NOT_VERIFIED' });
    render(<LoginForm redirectTo="/me" />);
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 인증이 필요합니다');
    expect(replace).not.toHaveBeenCalled();
  });

  it('401 AUTH_INVALID_CREDENTIALS → 자격 불일치 메시지', async () => {
    mockFetch(401, { code: 'AUTH_INVALID_CREDENTIALS' });
    render(<LoginForm redirectTo="/me" />);
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 또는 비밀번호');
    expect(replace).not.toHaveBeenCalled();
  });

  it('429 AUTH_ACCOUNT_LOCKED → 잠금 안내 메시지', async () => {
    mockFetch(429, { code: 'AUTH_ACCOUNT_LOCKED' });
    render(<LoginForm redirectTo="/me" />);
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('일시 잠겼습니다');
  });

  it('소셜/회원가입 링크가 redirect를 보존한다', () => {
    render(<LoginForm redirectTo="/jobs/6/apply" />);
    const enc = encodeURIComponent('/jobs/6/apply');
    expect(screen.getByRole('link', { name: 'Google로 계속하기' })).toHaveAttribute(
      'href',
      `/api/v1/auth/oauth/google?redirect=${enc}`,
    );
    expect(screen.getByRole('link', { name: 'GitHub로 계속하기' })).toHaveAttribute(
      'href',
      `/api/v1/auth/oauth/github?redirect=${enc}`,
    );
    expect(screen.getByRole('link', { name: '회원가입' })).toHaveAttribute(
      'href',
      `/signup?redirect=${enc}`,
    );
  });
});
