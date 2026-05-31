// CANDID-024 Step 4 — SocialAccountsSection 컴포넌트 테스트 (RTL, jsdom).
// 리뷰 MAJOR(test): fetch DELETE 분기(204→refresh / 409→alert) + 연결/미연결 렌더 검증.
// 모킹 경계: global fetch + next/navigation useRouter.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SocialAccountsSection } from '@/app/me/profile/_components/SocialAccountsSection';
import { SOCIAL_ACCOUNTS_LABELS as L } from '@/lib/users/profile-form';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function mockFetch(status: number): Mock {
  const fn = vi.fn(async () => ({ status })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

const googleLinked = [{ provider: 'google' as const, linkedAt: '2026-01-02T03:04:05.000Z' }];

beforeEach(() => {
  vi.restoreAllMocks();
  refreshMock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SocialAccountsSection', () => {
  it('연결된 provider는 해제 버튼, 미연결은 표시만', () => {
    render(<SocialAccountsSection providers={googleLinked} />);

    // google 연결 → 해제 버튼 1개. github 미연결 → '미연결' 텍스트.
    expect(screen.getByRole('button', { name: L.unlink })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(L.notLinked))).toBeInTheDocument();
  });

  it('해제 204 → DELETE 호출 + 안내 + router.refresh', async () => {
    const fetchFn = mockFetch(204);
    render(<SocialAccountsSection providers={googleLinked} />);

    await userEvent.setup().click(screen.getByRole('button', { name: L.unlink }));

    expect(fetchFn).toHaveBeenCalledWith('/api/v1/users/me/providers/google', { method: 'DELETE' });
    expect(screen.getByRole('status')).toHaveTextContent(L.unlinked);
    expect(refreshMock).toHaveBeenCalled();
  });

  it('마지막 인증수단(409) → 에러 alert + refresh 미호출', async () => {
    mockFetch(409);
    render(<SocialAccountsSection providers={googleLinked} />);

    await userEvent.setup().click(screen.getByRole('button', { name: L.unlink }));

    expect(screen.getByRole('alert')).toHaveTextContent(L.errorLastAuth);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
