import { vi } from 'vitest';

// CANDID-012 Step 2 — OAuth provider 단위 테스트 공통 mock 헬퍼.
// google.test.ts / github.test.ts 공유 — mockFetchSequence 중복 제거.

export interface MockResponse {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  contentLength?: string;
  throwOnFetch?: boolean;
  abort?: boolean;
}

/**
 * 순서대로 응답을 큐잉하는 fetch mock. 각 호출은 큐 head를 소비한다.
 * - `throwOnFetch`: 네트워크 실패 시뮬레이션
 * - `abort`: AbortError (timeout) 시뮬레이션
 */
export function mockFetchSequence(responses: MockResponse[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  return vi.fn(async () => {
    const r = queue.shift();
    if (!r) throw new Error('unexpected extra fetch call');
    if (r.throwOnFetch) throw new TypeError('network error');
    if (r.abort) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const headers = new Headers();
    if (r.contentLength !== undefined) headers.set('content-length', r.contentLength);
    const body =
      r.text !== undefined ? r.text : r.json !== undefined ? JSON.stringify(r.json) : '';
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      headers,
      text: async () => body,
    } as unknown as Response;
  });
}
