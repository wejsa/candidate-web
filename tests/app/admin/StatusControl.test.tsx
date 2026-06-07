// CANDID-053 Step 9 — StatusControl(상태 전이 버튼) 컴포넌트 테스트 (RTL, jsdom).
// 검증: 허용 전이만 버튼 노출(서버 SSOT 공유), CLOSED 종단, PATCH payload, 성공 refresh, 403/네트워크 에러.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

import { StatusControl } from '@/app/admin/job-postings/_components/StatusControl';

function mockFetch(status: number): Mock {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe('StatusControl', () => {
  it('CLOSED는 종단 — 버튼 없이 — 만 렌더', () => {
    render(<StatusControl jobPostingId={1} current="CLOSED" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('DRAFT → 공개/마감 버튼 노출(서버 SSOT 전이와 동일), DRAFT 버튼은 없음', () => {
    render(<StatusControl jobPostingId={1} current="DRAFT" />);
    expect(screen.getByRole('button', { name: '공개' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '마감' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '비공개' })).toBeNull();
  });

  it('OPEN → 비공개로/마감 버튼(공개 회수 가능)', () => {
    render(<StatusControl jobPostingId={1} current="OPEN" />);
    expect(screen.getByRole('button', { name: '비공개' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '마감' })).toBeInTheDocument();
  });

  it('공개 클릭 → PATCH {status:OPEN} 호출 후 refresh', async () => {
    const fetchMock = mockFetch(200);
    const user = userEvent.setup();
    render(<StatusControl jobPostingId={7} current="DRAFT" />);
    await user.click(screen.getByRole('button', { name: '공개' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/v1/job-postings/7');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ status: 'OPEN' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('403 → 권한 없음 alert, refresh 미호출', async () => {
    mockFetch(403);
    const user = userEvent.setup();
    render(<StatusControl jobPostingId={1} current="OPEN" />);
    await user.click(screen.getByRole('button', { name: '마감' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('권한 없음');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('네트워크 오류(fetch reject) → 네트워크 오류 alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    const user = userEvent.setup();
    render(<StatusControl jobPostingId={1} current="DRAFT" />);
    await user.click(screen.getByRole('button', { name: '마감' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 오류');
  });
});
