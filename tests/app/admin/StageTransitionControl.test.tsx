// CANDID-053 Step 12 — StageTransitionControl(전형 단계 전이 버튼) 테스트 (RTL, jsdom).
// 허용 전이만 노출(서버 SSOT 공유), 종단 단계 안내, PATCH payload, refresh, 에러 매핑.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { StageTransitionControl } from '@/app/admin/applications/_components/StageTransitionControl';
import { STAGE_TRANSITIONS } from '@/lib/admin/stage-transitions-graph';
import { stageLabel } from '@/lib/my-page/stage-labels';

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

describe('StageTransitionControl', () => {
  it('DOC_REVIEW → 1차 면접/불합격 버튼만(서버 전이 그래프와 동일)', () => {
    render(<StageTransitionControl applicationId={5} currentStage="DOC_REVIEW" />);
    expect(screen.getByRole('button', { name: /1차 면접/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /불합격/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /합격으로|최종 합격/ })).toBeNull();
  });

  it.each(['HIRED', 'REJECTED'])('%s는 종단 — 버튼 없이 안내', (stage) => {
    render(<StageTransitionControl applicationId={5} currentStage={stage as never} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/종단 단계/)).toBeInTheDocument();
  });

  it('INTERVIEW_1 → 2차 면접/처우 협의/불합격 3버튼(2차 생략 간선 포함)', () => {
    render(<StageTransitionControl applicationId={5} currentStage="INTERVIEW_1" />);
    expect(screen.getByRole('button', { name: /2차 면접/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /처우 협의/ })).toBeInTheDocument(); // OFFER
    expect(screen.getByRole('button', { name: /불합격/ })).toBeInTheDocument();
  });

  // 클라 노출 = 서버 SSOT 그래프 전수 일치(드리프트 시 실패) — STAGE_TRANSITIONS 전 단계 검증.
  it.each(Object.keys(STAGE_TRANSITIONS))('%s: 노출 버튼이 SSOT 전이 수와 일치', (stage) => {
    render(<StageTransitionControl applicationId={5} currentStage={stage as never} />);
    const targets = STAGE_TRANSITIONS[stage as keyof typeof STAGE_TRANSITIONS];
    expect(screen.queryAllByRole('button')).toHaveLength(targets.length);
    for (const to of targets) {
      expect(screen.getByRole('button', { name: new RegExp(stageLabel(to)) })).toBeInTheDocument();
    }
  });

  it('전이 진행 중 → 클릭 버튼 "처리 중…" + 전 버튼 disabled(이중 제출 차단)', async () => {
    let resolveFetch!: (v: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((r) => { resolveFetch = r; })),
    );
    const user = userEvent.setup();
    render(<StageTransitionControl applicationId={7} currentStage="DOC_REVIEW" />);
    await user.click(screen.getByRole('button', { name: /1차 면접/ }));
    expect(screen.getByRole('button', { name: /처리 중…/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /불합격/ })).toBeDisabled();
    resolveFetch({ ok: true, status: 200, json: async () => ({}) });
  });

  it.each([
    [404, 'APP_NOT_FOUND', '지원서를 찾을 수 없습니다'],
    [400, undefined, '요청을 확인'],
    [500, undefined, '잠시 후 다시 시도'],
  ])('에러 매핑 status=%s', async (status, code, expected) => {
    mockFetch(status as number, code ? { code } : {});
    const user = userEvent.setup();
    render(<StageTransitionControl applicationId={5} currentStage="SUBMITTED" />);
    await user.click(screen.getByRole('button', { name: /서류 검토/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected as string);
  });

  it('전이 클릭 → PATCH /stage {toStage} 후 refresh', async () => {
    const fetchMock = mockFetch(200, { toStage: 'INTERVIEW_1' });
    const user = userEvent.setup();
    render(<StageTransitionControl applicationId={7} currentStage="DOC_REVIEW" />);
    await user.click(screen.getByRole('button', { name: /1차 면접/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/v1/applications/7/stage');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ toStage: 'INTERVIEW_1' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('APP_INVALID_STAGE_TRANSITION(422) → 전이 불가 안내, refresh 미호출', async () => {
    mockFetch(422, { code: 'APP_INVALID_STAGE_TRANSITION' });
    const user = userEvent.setup();
    render(<StageTransitionControl applicationId={5} currentStage="OFFER" />);
    await user.click(screen.getByRole('button', { name: /최종 합격/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('허용되지 않는 전이');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('403 → 권한 없음', async () => {
    mockFetch(403, { code: 'AUTH_FORBIDDEN' });
    const user = userEvent.setup();
    render(<StageTransitionControl applicationId={5} currentStage="SUBMITTED" />);
    await user.click(screen.getByRole('button', { name: /서류 검토/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('권한이 없습니다');
  });

  it('네트워크 오류 → 안내', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down');
    }));
    const user = userEvent.setup();
    render(<StageTransitionControl applicationId={5} currentStage="SUBMITTED" />);
    await user.click(screen.getByRole('button', { name: /서류 검토/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 오류');
  });
});
