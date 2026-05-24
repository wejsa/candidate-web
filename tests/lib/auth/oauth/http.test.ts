import { afterEach, describe, expect, it } from 'vitest';
import { oauthFetchJson } from '@/lib/auth/oauth/http';
import { AppError } from '@/lib/errors';
import { mockFetchSequence } from './__test-helpers';

// CANDID-012 Step 2 — OAuth HTTP 헬퍼 단위 테스트.
// SSRF/DoS/timing 방어 가드: 5초 timeout, 1MB 응답 cap, JSON 파싱 실패, 네트워크 오류,
// 5xx 응답 — 모두 AUTH_OAUTH_PROVIDER_ERROR로 수렴.

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('oauthFetchJson', () => {
  it('happy: 200 + JSON 응답 → 파싱된 객체', async () => {
    global.fetch = mockFetchSequence([{ ok: true, json: { hello: 'world' } }]) as unknown as typeof fetch;
    const result = await oauthFetchJson<{ hello: string }>({
      method: 'GET',
      url: 'https://provider.example.com/x',
    });
    expect(result).toEqual({ hello: 'world' });
  });

  it('5xx 응답 → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    global.fetch = mockFetchSequence([{ ok: false, status: 500 }]) as unknown as typeof fetch;
    await expect(
      oauthFetchJson({ method: 'GET', url: 'https://x/y' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
  });

  it('네트워크 실패 (fetch throw) → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    global.fetch = mockFetchSequence([{ ok: false, throwOnFetch: true }]) as unknown as typeof fetch;
    await expect(oauthFetchJson({ method: 'GET', url: 'https://x/y' })).rejects.toBeInstanceOf(AppError);
  });

  it('AbortError (timeout) → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    global.fetch = mockFetchSequence([{ ok: false, abort: true }]) as unknown as typeof fetch;
    await expect(
      oauthFetchJson({ method: 'GET', url: 'https://x/y' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
  });

  it('Content-Length > 1MB → AUTH_OAUTH_PROVIDER_ERROR (DoS 차단)', async () => {
    global.fetch = mockFetchSequence([
      { ok: true, contentLength: String((1 << 20) + 1), text: 'unused' },
    ]) as unknown as typeof fetch;
    await expect(
      oauthFetchJson({ method: 'GET', url: 'https://x/y' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
  });

  it('응답 본문 > 1MB (Content-Length 없을 때) → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    const big = 'x'.repeat((1 << 20) + 1);
    global.fetch = mockFetchSequence([{ ok: true, text: big }]) as unknown as typeof fetch;
    await expect(
      oauthFetchJson({ method: 'GET', url: 'https://x/y' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
  });

  it('JSON 파싱 실패 → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    global.fetch = mockFetchSequence([{ ok: true, text: '{invalid json' }]) as unknown as typeof fetch;
    await expect(
      oauthFetchJson({ method: 'GET', url: 'https://x/y' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
  });
});
