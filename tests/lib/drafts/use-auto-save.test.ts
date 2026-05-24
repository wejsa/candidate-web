// CANDID-015 Step 4 — use-auto-save hook 단위 테스트 (jsdom 환경).
// environmentMatchGlobs로 jsdom 환경에서만 실행. React import 없이 hook 함수만 호출하는
// 형태가 어렵기 때문에 minimal renderer로 React 18 + fake timers 조합 사용.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoSave } from '@/lib/drafts/use-auto-save';
import type { DraftPayloadV1 } from '@/lib/drafts/types';

// React 18 act + minimal renderer (jsdom-only). RTL 없이 hook 호출.
// vitest는 jsdom 환경에서 React를 import 가능.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';

function makePayload(step: 1 | 2 | 3 = 1): DraftPayloadV1 {
  return {
    schemaVersion: 1,
    meta: { currentStep: step, completedSteps: [] },
    step1_personal: {
      name: '홍길동',
      phone: '010-1234-5678',
      birthDate: '2000-01-01',
      careerLevel: 'NEW',
    },
  };
}

interface HookHolder {
  current: ReturnType<typeof useAutoSave> | null;
}

function renderHook(
  fetcher: typeof fetch,
  opts: { debounceMs?: number; intervalMs?: number } = {},
): { holder: HookHolder; rerender: () => void; unmount: () => void; root: Root } {
  const holder: HookHolder = { current: null };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function HookHost(): ReactElement | null {
    const api = useAutoSave({
      jobPostingId: 42,
      initialVersion: 1,
      initialLastSavedAt: '2026-05-24T00:00:00.000Z',
      fetcher,
      debounceMs: opts.debounceMs,
      intervalMs: opts.intervalMs,
    });
    holder.current = api;
    return null;
  }
  act(() => {
    root.render(createElement(HookHost));
  });
  return {
    holder,
    rerender: () => act(() => root.render(createElement(HookHost))),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    root,
  };
}

function makeFetcher(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAutoSave — debounce', () => {
  it('notifyChange 후 debounceMs 경과 시 PUT 호출 (1회)', async () => {
    const fetcher = makeFetcher(200, { version: 2, lastSavedAt: '2026-05-24T00:00:01.000Z' });
    const { holder, unmount } = renderHook(fetcher, { debounceMs: 1000, intervalMs: 0 });
    act(() => holder.current!.notifyChange(makePayload()));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
      // flush microtasks
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('연속 입력 시 debounce 재시작 → 마지막 입력 후 한 번만 PUT', async () => {
    const fetcher = makeFetcher(200, { version: 2, lastSavedAt: '2026-05-24T00:00:01.000Z' });
    const { holder, unmount } = renderHook(fetcher, { debounceMs: 1000, intervalMs: 0 });
    act(() => holder.current!.notifyChange(makePayload()));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    act(() => holder.current!.notifyChange(makePayload(2)));
    await act(async () => {
      vi.advanceTimersByTime(500); // 첫 호출 1000ms 도달했지만 두 번째 notifyChange가 리셋
    });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(500); // 1000ms 도달
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('useAutoSave — zod 가드 (L-019 D-MAJOR-1)', () => {
  it('부분 입력 (만 14세 미만) → PUT 시도 안 함', async () => {
    const fetcher = makeFetcher(200, { version: 2, lastSavedAt: '2026-05-24T00:00:01.000Z' });
    const { holder, unmount } = renderHook(fetcher, { debounceMs: 100, intervalMs: 0 });
    const invalidPayload: DraftPayloadV1 = {
      schemaVersion: 1,
      meta: { currentStep: 1, completedSteps: [] },
      step1_personal: {
        name: '아이',
        phone: '010-1234-5678',
        birthDate: '2020-01-01', // 만 14세 미만
        careerLevel: 'NEW',
      },
    };
    act(() => holder.current!.notifyChange(invalidPayload));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(fetcher).not.toHaveBeenCalled();
    unmount();
  });
});

describe('useAutoSave — saveNow + saved 상태', () => {
  it('saveNow → 즉시 PUT + status="saved" + version 갱신', async () => {
    const fetcher = makeFetcher(200, { version: 5, lastSavedAt: '2026-05-24T00:00:02.000Z' });
    const { holder, unmount } = renderHook(fetcher, { debounceMs: 5000, intervalMs: 0 });
    act(() => holder.current!.notifyChange(makePayload()));
    await act(async () => {
      await holder.current!.saveNow();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(holder.current!.status).toBe('saved');
    expect(holder.current!.version).toBe(5);
    expect(holder.current!.isDirty).toBe(false);
    unmount();
  });
});

describe('useAutoSave — 409 conflict 일시정지', () => {
  it('409 응답 → status="conflict" + 후속 자동 저장 차단', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'APP_DRAFT_CONFLICT' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 9, lastSavedAt: 'x' }), { status: 200 }));
    const { holder, unmount } = renderHook(fetcher as unknown as typeof fetch, {
      debounceMs: 100,
      intervalMs: 0,
    });
    act(() => holder.current!.notifyChange(makePayload()));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(holder.current!.status).toBe('conflict');
    // 후속 notifyChange는 paused이므로 PUT 호출 안 함
    act(() => holder.current!.notifyChange(makePayload(2)));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('useAutoSave — failed (네트워크 실패) 비차단', () => {
  it('5xx → status="failed" + errorMessage + isDirty 유지 (사용자 재시도 가능)', async () => {
    const fetcher = makeFetcher(500, { code: 'SYS_INTERNAL_ERROR' });
    const { holder, unmount } = renderHook(fetcher, { debounceMs: 100, intervalMs: 0 });
    act(() => holder.current!.notifyChange(makePayload()));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(holder.current!.status).toBe('failed');
    expect(holder.current!.isDirty).toBe(true);
    unmount();
  });
});

describe('useAutoSave — interval', () => {
  it('intervalMs 경과 + isDirty true → 자동 PUT', async () => {
    const fetcher = makeFetcher(200, { version: 2, lastSavedAt: 'x' });
    const { holder, unmount } = renderHook(fetcher, { debounceMs: 0, intervalMs: 1000 });
    act(() => holder.current!.notifyChange(makePayload()));
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('useAutoSave — cleanup', () => {
  it('unmount 후 debounce 타이머 콜백 발화 안 됨', async () => {
    const fetcher = makeFetcher(200, { version: 2, lastSavedAt: 'x' });
    const { holder, unmount } = renderHook(fetcher, { debounceMs: 1000, intervalMs: 0 });
    act(() => holder.current!.notifyChange(makePayload()));
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('useAutoSave — beforeunload', () => {
  it('isDirty 시 beforeunload preventDefault 호출', () => {
    const fetcher = makeFetcher(200, { version: 2, lastSavedAt: 'x' });
    const { holder, unmount } = renderHook(fetcher, { debounceMs: 5000, intervalMs: 0 });
    act(() => holder.current!.notifyChange(makePayload()));
    expect(holder.current!.isDirty).toBe(true);

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(true);
    unmount();
  });
});
