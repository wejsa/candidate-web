// CANDID-023 Step 4 — notifyApplicationWithdrawn 단위 테스트.
//
// 검증: SLACK_WEBHOOK_URL 미설정 → no-op(fetch 미호출), 설정 → POST + PII-free 메시지(hasReason).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/env', () => ({ getEnv: vi.fn() }));

const { getEnv } = (await import('@/lib/env')) as unknown as { getEnv: Mock };
const { notifyApplicationWithdrawn } = await import('@/lib/notifications/slack');

function stubFetch(): Mock {
  const fn = vi.fn(async () => ({ ok: true })) as unknown as Mock;
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
  getEnv.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notifyApplicationWithdrawn', () => {
  it('SLACK_WEBHOOK_URL 미설정 → no-op (fetch 미호출)', async () => {
    getEnv.mockReturnValue({ SLACK_WEBHOOK_URL: undefined });
    const fetchMock = stubFetch();

    await notifyApplicationWithdrawn({ applicationId: 100, hasReason: true });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('설정 시 webhook으로 POST — 사유 평문 미포함, hasReason만 (BR-PII-02)', async () => {
    getEnv.mockReturnValue({ SLACK_WEBHOOK_URL: 'https://hooks.slack.test/abc' });
    const fetchMock = stubFetch();

    await notifyApplicationWithdrawn({ applicationId: 42, hasReason: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.slack.test/abc');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain('지원 #42 철회됨');
    expect(body.text).toContain('사유 있음');
  });

  it('hasReason=false → "사유 없음"', async () => {
    getEnv.mockReturnValue({ SLACK_WEBHOOK_URL: 'https://hooks.slack.test/abc' });
    const fetchMock = stubFetch();

    await notifyApplicationWithdrawn({ applicationId: 5, hasReason: false });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.text).toContain('사유 없음');
  });
});
