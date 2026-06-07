// CANDID-066 Step 3 — ResumeDownloadButton(Client) 테스트 (RTL, jsdom).
// 검증: INFECTED 차단 배지(버튼 없음), 정상 다운로드(presigned URL → window.open), 403/네트워크 에러.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ResumeDownloadButton } from '@/app/admin/applications/_components/ResumeDownloadButton';

function mockFetch(status: number, body: unknown = {}): Mock {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ResumeDownloadButton', () => {
  it('INFECTED → 차단 배지(alert)만 렌더, 다운로드 버튼 없음', () => {
    render(<ResumeDownloadButton applicationId={5} virusScanStatus="INFECTED" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('감염');
  });

  it('CLEAN → 다운로드 버튼 렌더', () => {
    render(<ResumeDownloadButton applicationId={5} virusScanStatus="CLEAN" />);
    expect(screen.getByRole('button', { name: '이력서 다운로드' })).toBeInTheDocument();
  });

  it('PENDING(스캔 미완)도 다운로드 버튼 렌더(차단 안 함)', () => {
    render(<ResumeDownloadButton applicationId={5} virusScanStatus="PENDING" />);
    expect(screen.getByRole('button', { name: '이력서 다운로드' })).toBeInTheDocument();
  });

  it('클릭 → presigned URL fetch 후 window.open(noopener)으로 다운로드', async () => {
    const fetchMock = mockFetch(200, { url: 'https://s3.example/presigned-get', filename: 'r.pdf' });
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    const user = userEvent.setup();
    render(<ResumeDownloadButton applicationId={7} virusScanStatus="CLEAN" />);
    await user.click(screen.getByRole('button', { name: '이력서 다운로드' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/v1/applications/7/resume'));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://s3.example/presigned-get',
        '_blank',
        'noopener,noreferrer',
      ),
    );
  });

  it('403 → 권한 없음 alert, window.open 미호출', async () => {
    mockFetch(403);
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    const user = userEvent.setup();
    render(<ResumeDownloadButton applicationId={1} virusScanStatus="CLEAN" />);
    await user.click(screen.getByRole('button', { name: '이력서 다운로드' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('권한 없음');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('409 → 감염 파일 차단 alert', async () => {
    mockFetch(409);
    const user = userEvent.setup();
    render(<ResumeDownloadButton applicationId={1} virusScanStatus="PENDING" />);
    await user.click(screen.getByRole('button', { name: '이력서 다운로드' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('감염 파일');
  });

  it('네트워크 오류(fetch reject) → 네트워크 오류 alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    const user = userEvent.setup();
    render(<ResumeDownloadButton applicationId={1} virusScanStatus="CLEAN" />);
    await user.click(screen.getByRole('button', { name: '이력서 다운로드' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 오류');
  });
});
