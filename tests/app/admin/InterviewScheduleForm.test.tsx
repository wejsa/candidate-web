// CANDID-053 Step 12 — InterviewScheduleForm(면접 일정 폼) 테스트 (RTL, jsdom).
// POST payload(UTC ISO), 빈값 검증, 성공 refresh, 단계 select, 에러 매핑(WITHDRAWN/403).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { InterviewScheduleForm } from '@/app/admin/applications/_components/InterviewScheduleForm';

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
  refresh.mockReset();
});

describe('InterviewScheduleForm', () => {
  it('공백만 장소(native required 통과) → JS 검증 에러, fetch 미호출', async () => {
    const fetchMock = mockFetch(201);
    const user = userEvent.setup();
    render(<InterviewScheduleForm applicationId={5} />);
    // 일시는 채우고 장소는 공백 — required는 통과하지만 trim() 검증에서 차단.
    await user.type(screen.getByLabelText(/일시/), '2026-07-10T09:00');
    await user.type(screen.getByLabelText('장소/화상 링크'), '   ');
    await user.click(screen.getByRole('button', { name: /면접 일정 저장/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('일시와 장소');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('입력 후 제출 → POST /interviews {stage, scheduledAt UTC ISO, locationOrUrl} + refresh', async () => {
    const fetchMock = mockFetch(201, { created: true });
    const user = userEvent.setup();
    render(<InterviewScheduleForm applicationId={7} />);
    await user.type(screen.getByLabelText(/일시/), '2026-07-10T09:00');
    await user.type(screen.getByLabelText('장소/화상 링크'), 'https://meet.example.com/a');
    await user.click(screen.getByRole('button', { name: /면접 일정 저장/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/v1/applications/7/interviews');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      stage: 'INTERVIEW_1',
      scheduledAt: '2026-07-10T09:00:00.000Z',
      locationOrUrl: 'https://meet.example.com/a',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('단계 INTERVIEW_2 선택 반영', async () => {
    const fetchMock = mockFetch(200, { created: false });
    const user = userEvent.setup();
    render(<InterviewScheduleForm applicationId={7} />);
    await user.selectOptions(screen.getByLabelText('면접 단계'), 'INTERVIEW_2');
    await user.type(screen.getByLabelText(/일시/), '2026-07-12T09:00');
    await user.type(screen.getByLabelText('장소/화상 링크'), '회의실 A');
    await user.click(screen.getByRole('button', { name: /면접 일정 저장/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).stage).toBe('INTERVIEW_2');
  });

  it('철회 지원서(APP_INVALID_STAGE_TRANSITION) → 등록 불가 안내', async () => {
    mockFetch(422, { code: 'APP_INVALID_STAGE_TRANSITION' });
    const user = userEvent.setup();
    render(<InterviewScheduleForm applicationId={5} />);
    await user.type(screen.getByLabelText(/일시/), '2026-07-10T09:00');
    await user.type(screen.getByLabelText('장소/화상 링크'), '회의실');
    await user.click(screen.getByRole('button', { name: /면접 일정 저장/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('철회된 지원서');
  });

  it('네트워크 오류 → 안내', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down');
    }));
    const user = userEvent.setup();
    render(<InterviewScheduleForm applicationId={5} />);
    await user.type(screen.getByLabelText(/일시/), '2026-07-10T09:00');
    await user.type(screen.getByLabelText('장소/화상 링크'), '회의실');
    await user.click(screen.getByRole('button', { name: /면접 일정 저장/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 오류');
  });

  it('저장 중 → 입력/버튼 disabled("저장 중…")', async () => {
    let resolveFetch!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { resolveFetch = r; })));
    const user = userEvent.setup();
    render(<InterviewScheduleForm applicationId={7} />);
    await user.type(screen.getByLabelText(/일시/), '2026-07-10T09:00');
    await user.type(screen.getByLabelText('장소/화상 링크'), '회의실');
    await user.click(screen.getByRole('button', { name: /면접 일정 저장/ }));
    expect(screen.getByRole('button', { name: /저장 중…/ })).toBeDisabled();
    expect(screen.getByLabelText('장소/화상 링크')).toBeDisabled();
    resolveFetch({ ok: true, status: 201, json: async () => ({}) });
  });

  it('성공 후 장소/링크 입력 초기화(연속 등록 UX)', async () => {
    mockFetch(201, { created: true });
    const user = userEvent.setup();
    render(<InterviewScheduleForm applicationId={7} />);
    await user.type(screen.getByLabelText(/일시/), '2026-07-10T09:00');
    const loc = screen.getByLabelText('장소/화상 링크') as HTMLInputElement;
    await user.type(loc, '회의실 A');
    await user.click(screen.getByRole('button', { name: /면접 일정 저장/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(loc.value).toBe('');
  });

  it.each([
    [404, 'APP_NOT_FOUND', '지원서를 찾을 수 없습니다'],
    [400, undefined, '입력값을 다시 확인'],
    [500, undefined, '잠시 후 다시 시도'],
  ])('에러 매핑 status=%s', async (status, code, expected) => {
    mockFetch(status as number, code ? { code } : {});
    const user = userEvent.setup();
    render(<InterviewScheduleForm applicationId={5} />);
    await user.type(screen.getByLabelText(/일시/), '2026-07-10T09:00');
    await user.type(screen.getByLabelText('장소/화상 링크'), '회의실');
    await user.click(screen.getByRole('button', { name: /면접 일정 저장/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected as string);
  });
});
