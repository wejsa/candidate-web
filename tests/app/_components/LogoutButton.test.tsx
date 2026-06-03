// CANDID-050 Step 2 — LogoutButton 컴포넌트 테스트 (RTL, jsdom).
// 핵심: 멱등 로그아웃 — fetch 성공/실패 모두 router.replace('/') + refresh로 UI 상태 초기화.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));

import { LogoutButton } from '@/app/_components/LogoutButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
  refresh.mockReset();
});

describe('LogoutButton', () => {
  it('로그아웃 성공(200) → /logout 호출 + replace("/") + refresh', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LogoutButton />);
    await userEvent.setup().click(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout', { method: 'POST' });
    expect(refresh).toHaveBeenCalled();
  });

  it('네트워크 실패에도 replace("/") 호출 (멱등 보장)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    );
    render(<LogoutButton />);
    await userEvent.setup().click(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(refresh).toHaveBeenCalled();
  });
});
