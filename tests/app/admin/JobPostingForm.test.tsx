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

  it('마감일시 입력 시 closesAt도 UTC ISO로 전송(상시 아님)', async () => {
    const fetchMock = mockFetch(201, { id: 10 });
    const user = userEvent.setup();
    render(<JobPostingForm mode="create" categories={CATEGORIES} />);
    await user.type(screen.getByLabelText('제목'), 'T');
    await user.type(screen.getByLabelText('본문(HTML)'), '<p>x</p>');
    await user.type(screen.getByLabelText(/시작일시/), '2026-07-01T05:00');
    await user.type(screen.getByLabelText(/마감일시/), '2026-07-31T14:30');
    await user.click(screen.getByRole('button', { name: /공고 생성/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).closesAt).toBe('2026-07-31T14:30:00.000Z');
  });

  it('마감 ≤ 시작 → 클라 선검증 차단(서버 refine과 동일), fetch 미호출', async () => {
    const fetchMock = mockFetch(201);
    const user = userEvent.setup();
    render(<JobPostingForm mode="create" categories={CATEGORIES} />);
    await user.type(screen.getByLabelText('제목'), 'T');
    await user.type(screen.getByLabelText('본문(HTML)'), '<p>x</p>');
    await user.type(screen.getByLabelText(/시작일시/), '2026-07-31T14:30');
    await user.type(screen.getByLabelText(/마감일시/), '2026-07-01T05:00'); // 시작보다 앞
    await user.click(screen.getByRole('button', { name: /공고 생성/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('마감일시는 시작일시보다 이후');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('select 변경(직군/고용형태/경력)이 제출 body에 반영', async () => {
    const fetchMock = mockFetch(201, { id: 10 });
    const user = userEvent.setup();
    render(<JobPostingForm mode="create" categories={CATEGORIES} />);
    await user.type(screen.getByLabelText('제목'), 'T');
    await user.type(screen.getByLabelText('본문(HTML)'), '<p>x</p>');
    await user.type(screen.getByLabelText(/시작일시/), '2026-07-01T05:00');
    await user.selectOptions(screen.getByLabelText('직군'), '2');
    await user.selectOptions(screen.getByLabelText('고용형태'), 'CONTRACT');
    await user.selectOptions(screen.getByLabelText('경력'), 'NEW');
    await user.click(screen.getByRole('button', { name: /공고 생성/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      jobCategoryId: 2,
      employmentType: 'CONTRACT',
      careerLevel: 'NEW',
    });
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

  it.each([
    [400, { code: 'SYS_VALIDATION_FAILED' }, '입력값을 다시 확인'],
    [500, {}, '잠시 후 다시 시도'],
  ])('에러 매핑 status=%s → 메시지', async (status, respBody, expected) => {
    mockFetch(status as number, respBody);
    const user = userEvent.setup();
    render(<JobPostingForm mode="create" categories={CATEGORIES} />);
    await user.type(screen.getByLabelText('제목'), 'T');
    await user.type(screen.getByLabelText('본문(HTML)'), '<p>x</p>');
    await user.type(screen.getByLabelText(/시작일시/), '2026-07-01T05:00');
    await user.click(screen.getByRole('button', { name: /공고 생성/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected as string);
  });

  it('네트워크 오류(fetch reject) → 네트워크 오류 메시지, push 미호출', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    const user = userEvent.setup();
    render(<JobPostingForm mode="create" categories={CATEGORIES} />);
    await user.type(screen.getByLabelText('제목'), 'T');
    await user.type(screen.getByLabelText('본문(HTML)'), '<p>x</p>');
    await user.type(screen.getByLabelText(/시작일시/), '2026-07-01T05:00');
    await user.click(screen.getByRole('button', { name: /공고 생성/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 오류');
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

  it('모든 필드 프리필 + 제출 → PATCH /{id} body 라운드트립(프리필값 손실 없음)', async () => {
    const fetchMock = mockFetch(200, { id: 42 });
    const user = userEvent.setup();
    render(<JobPostingForm mode="edit" categories={CATEGORIES} initial={initial} />);
    // 프리필 정확성 — select 3종/본문까지(일부 필드만 검증 시 덮어쓰기 회귀 누락).
    expect((screen.getByLabelText('제목') as HTMLInputElement).value).toBe('기존 공고');
    expect((screen.getByLabelText('직군') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText('고용형태') as HTMLSelectElement).value).toBe('CONTRACT');
    expect((screen.getByLabelText('경력') as HTMLSelectElement).value).toBe('NEW');
    expect((screen.getByLabelText('본문(HTML)') as HTMLTextAreaElement).value).toBe('<p>old</p>');
    await user.click(screen.getByRole('button', { name: /변경 저장/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/v1/job-postings/42');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toMatchObject({
      title: '기존 공고',
      jobCategoryId: 2,
      employmentType: 'CONTRACT',
      careerLevel: 'NEW',
      contentHtml: '<p>old</p>',
      opensAt: '2026-07-01T05:00:00.000Z',
      closesAt: null,
    });
  });
});
