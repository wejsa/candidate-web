// CANDID — DiscardDraftButton (작성 취소) 컴포넌트 테스트 (RTL, jsdom).
//
// 검증: 2단계 확인 토글, 아니오 취소, 삭제 시 DELETE fetch + 204→router.refresh,
//       401/기타 status/네트워크 예외별 인라인 에러 메시지.
// 모킹 경계: global fetch + next/navigation useRouter.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

import { DiscardDraftButton } from '@/app/me/_components/DiscardDraftButton';

function mockFetch(status: number): Mock {
  const fn = vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({}),
  })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** "작성 취소" 클릭 → 확인 단계 진입. */
async function openConfirm(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '작성 취소' }));
  return user;
}

beforeEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiscardDraftButton', () => {
  it('초기엔 확인 UI 미노출 — "작성 취소" 버튼만', () => {
    render(<DiscardDraftButton jobPostingId={42} />);
    expect(screen.getByRole('button', { name: '작성 취소' })).toBeTruthy();
    expect(screen.queryByText('작성 중인 내용을 삭제할까요?')).toBeNull();
  });

  it('"작성 취소" 클릭 → 확인 프롬프트 + 삭제/아니오 노출', async () => {
    render(<DiscardDraftButton jobPostingId={42} />);
    await openConfirm();
    expect(screen.getByText('작성 중인 내용을 삭제할까요?')).toBeTruthy();
    expect(screen.getByRole('button', { name: '삭제' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '아니오' })).toBeTruthy();
  });

  it('"아니오" → 확인 UI 닫힘, fetch 미호출', async () => {
    const fetchMock = mockFetch(204);
    render(<DiscardDraftButton jobPostingId={42} />);
    const user = await openConfirm();
    await user.click(screen.getByRole('button', { name: '아니오' }));
    expect(screen.queryByText('작성 중인 내용을 삭제할까요?')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('"삭제" + 204 → DELETE 호출 + router.refresh', async () => {
    const fetchMock = mockFetch(204);
    render(<DiscardDraftButton jobPostingId={42} />);
    const user = await openConfirm();
    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/drafts/42', { method: 'DELETE' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('401 → refresh 미호출 + 세션 만료 메시지', async () => {
    mockFetch(401);
    render(<DiscardDraftButton jobPostingId={42} />);
    const user = await openConfirm();
    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('세션이 만료');
  });

  it('500 → 실패 메시지', async () => {
    mockFetch(500);
    render(<DiscardDraftButton jobPostingId={42} />);
    const user = await openConfirm();
    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('작성 취소에 실패');
  });

  it('fetch 예외(네트워크) → 네트워크 오류 메시지', async () => {
    const fn = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as Mock;
    vi.stubGlobal('fetch', fn);
    render(<DiscardDraftButton jobPostingId={42} />);
    const user = await openConfirm();
    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('네트워크 오류');
  });
});
