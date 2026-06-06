// CANDID-053 Step 9 — JobPostingForm 컴포넌트 테스트 (RTL, jsdom).
// 검증: create=POST/edit=PATCH 엔드포인트·메서드, datetime-local→UTC ISO 변환, 빈값 검증,
//       에러코드 매핑, 성공 시 목록으로 push+refresh.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
}));

import { JobPostingForm } from '@/app/admin/job-postings/_components/JobPostingForm';

const CATEGORIES = [
  { id: 1, name: '엔지니어링' },
  { id: 2, name: '디자인' },
];

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
  push.mockReset();
  refresh.mockReset();
});

describe('JobPostingForm — create', () => {
  it('필수 입력 후 제출 → POST /job-postings + opensAt UTC ISO + closesAt null, 성공 시 목록 push', async () => {
    const fetchMock = mockFetch(201, { id: 10 });
    const user = userEvent.setup();
    render(<JobPostingForm mode="create" categories={CATEGORIES} />);

    await user.type(screen.getByLabelText('제목'), '백엔드 엔지니어');
    await user.type(screen.getByLabelText('본문(HTML)'), '<p>본문</p>');
    // datetime-local은 fireEvent 스타일로 값 주입(브라우저별 입력 편차 회피).
    const opens = screen.getByLabelText(/시작일시/) as HTMLInputElement;
    await user.clear(opens);
    await user.type(opens, '2026-07-01T05:00');
    await user.click(screen.getByRole('button', { name: /공고 생성/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/v1/job-postings');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({ title: '백엔드 엔지니어', jobCategoryId: 1, closesAt: null });
    expect(body.opensAt).toBe('2026-07-01T05:00:00.000Z'); // datetime-local을 UTC로 해석
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/job-postings'));
    expect(refresh).toHaveBeenCalled();
  });

  it('공백만 입력(native required는 통과) → JS trim 검증 에러, fetch 미호출', async () => {
    const fetchMock = mockFetch(201);
    const user = userEvent.setup();
    render(<JobPostingForm mode="create" categories={CATEGORIES} />);
    // 공백은 required(비어있지 않음)는 통과하지만 trim() 검증에서 차단되어야 한다.
    await user.type(screen.getByLabelText('제목'), '   ');
    await user.type(screen.getByLabelText('본문(HTML)'), '<p>x</p>');
    await user.type(screen.getByLabelText(/시작일시/), '2026-07-01T05:00');
    await user.click(screen.getByRole('button', { name: /공고 생성/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('제목과 본문');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403 AUTH_FORBIDDEN → 권한 없음 메시지, push 미호출', async () => {
    mockFetch(403, { code: 'AUTH_FORBIDDEN' });
    const user = userEvent.setup();
    render(<JobPostingForm mode="create" categories={CATEGORIES} />);
    await user.type(screen.getByLabelText('제목'), 'T');
    await user.type(screen.getByLabelText('본문(HTML)'), '<p>x</p>');
    await user.type(screen.getByLabelText(/시작일시/), '2026-07-01T05:00');
    await user.click(screen.getByRole('button', { name: /공고 생성/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('권한이 없습니다');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('JobPostingForm — edit', () => {
  const initial = {
    id: 42,
    title: '기존 공고',
    jobCategoryId: 2,
    employmentType: 'CONTRACT' as const,
    careerLevel: 'NEW' as const,
    contentHtml: '<p>old</p>',
    opensAtLocal: '2026-07-01T05:00',
    closesAtLocal: '',
  };

  it('프리필 + 제출 → PATCH /job-postings/{id}', async () => {
    const fetchMock = mockFetch(200, { id: 42 });
    const user = userEvent.setup();
    render(<JobPostingForm mode="edit" categories={CATEGORIES} initial={initial} />);
    expect((screen.getByLabelText('제목') as HTMLInputElement).value).toBe('기존 공고');
    await user.click(screen.getByRole('button', { name: /변경 저장/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/v1/job-postings/42');
    expect(opts.method).toBe('PATCH');
  });
});
