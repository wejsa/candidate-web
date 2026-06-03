// CANDID-023 Step 4 — WithdrawButton 컴포넌트 테스트 (RTL, jsdom).
//
// 검증: 모달 토글, 사유 유무별 POST body, 성공/409 → router.refresh, 에러/네트워크 예외 인라인 표시.
// 모킹 경계: global fetch + next/navigation useRouter.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

import { WithdrawButton } from '@/app/me/_components/WithdrawButton';

function mockFetch(status: number): Mock {
  const fn = vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({}),
  })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function openModal(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '지원 철회' }));
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

describe('WithdrawButton', () => {
  it('초기: 철회 버튼만 렌더, 모달 미표시', () => {
    render(<WithdrawButton applicationId={100} />);
    expect(screen.getByRole('button', { name: '지원 철회' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('철회 버튼 클릭 → 확인 모달(dialog + 사유 입력) 표시', async () => {
    render(<WithdrawButton applicationId={100} />);
    await openModal();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('철회 사유 (선택)')).toBeInTheDocument();
  });

  it('사유 입력 + 철회 확인 → POST(reason 포함) + router.refresh', async () => {
    const fetchMock = mockFetch(200);
    render(<WithdrawButton applicationId={100} />);
    const user = await openModal();

    await user.type(screen.getByLabelText('철회 사유 (선택)'), '  개인 사정  ');
    await user.click(screen.getByRole('button', { name: '철회 확인' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/applications/me/100/withdraw',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: '개인 사정' }),
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('사유 미입력 → POST body reason=undefined', async () => {
    const fetchMock = mockFetch(200);
    render(<WithdrawButton applicationId={7} />);
    const user = await openModal();
    await user.click(screen.getByRole('button', { name: '철회 확인' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/applications/me/7/withdraw',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('409(이미 철회) → router.refresh (멱등 처리)', async () => {
    mockFetch(409);
    render(<WithdrawButton applicationId={100} />);
    const user = await openModal();
    await user.click(screen.getByRole('button', { name: '철회 확인' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('서버 오류(500) → 인라인 에러 alert, 모달 유지, refresh 미호출', async () => {
    mockFetch(500);
    render(<WithdrawButton applicationId={100} />);
    const user = await openModal();
    await user.click(screen.getByRole('button', { name: '철회 확인' }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('네트워크 예외 → 인라인 에러 표시 (pending 고착 방지)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    render(<WithdrawButton applicationId={100} />);
    const user = await openModal();
    await user.click(screen.getByRole('button', { name: '철회 확인' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('취소 → 모달 닫힘, POST 미호출', async () => {
    const fetchMock = mockFetch(200);
    render(<WithdrawButton applicationId={100} />);
    const user = await openModal();
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('취소 후 재오픈 시 사유 입력 초기화 (잠재 PII 잔존 방지)', async () => {
    render(<WithdrawButton applicationId={100} />);
    const user = await openModal();
    await user.type(screen.getByLabelText('철회 사유 (선택)'), '민감 사유');
    await user.click(screen.getByRole('button', { name: '취소' }));
    await user.click(screen.getByRole('button', { name: '지원 철회' }));
    expect(screen.getByLabelText('철회 사유 (선택)')).toHaveValue('');
  });

  // CANDID-028 Step 2 — focus-trap
  it('오픈 시 포커스가 다이얼로그 내부로 이동', async () => {
    render(<WithdrawButton applicationId={100} />);
    await openModal();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('ESC → 모달 닫힘 + 트리거 버튼으로 포커스 복원', async () => {
    render(<WithdrawButton applicationId={100} />);
    await openModal();
    const trigger = screen.getByRole('button', { name: '지원 철회' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('철회 확인은 destructive(.btn-danger) 스타일로 구분된다', async () => {
    render(<WithdrawButton applicationId={100} />);
    await openModal();
    expect(screen.getByRole('button', { name: '철회 확인' })).toHaveClass('btn-danger');
  });
});
