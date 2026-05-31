import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { __resetRateLimitStateForTesting } from '@/lib/security/rate-limit';

// CANDID-012 Step 3 — GET /api/v1/auth/oauth/{provider} start handler 라우터 테스트.
// state.ts + provider impl mock — 라우터의 화이트리스트/redirect sanitize/Set-Cookie/302만 검증.

vi.mock('@/lib/auth/oauth/state', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/oauth/state')>('@/lib/auth/oauth/state');
  return {
    ...actual,
    createOAuthState: vi.fn(() => ({
      state: 'mock-state-64char-' + 'a'.repeat(48),
      codeVerifier: 'mock-verifier',
      codeChallenge: 'mock-challenge',
      cookieValue: 'mock-cookie.signed',
      cookieExpires: new Date('2026-12-31T00:00:00Z'),
    })),
  };
});
vi.mock('@/lib/auth/oauth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/oauth')>('@/lib/auth/oauth');
  return {
    ...actual,
    isOAuthProviderEnabled: vi.fn(),
    getProvider: vi.fn(),
  };
});
// CANDID-024 Step 5 — link 모드 인증 분기 검증용.
vi.mock('@/lib/auth/middleware', () => ({ getOptionalAuth: vi.fn() }));

const { isOAuthProviderEnabled, getProvider } = (await import('@/lib/auth/oauth')) as unknown as {
  isOAuthProviderEnabled: ReturnType<typeof vi.fn>;
  getProvider: ReturnType<typeof vi.fn>;
};
const { createOAuthState } = (await import('@/lib/auth/oauth/state')) as unknown as {
  createOAuthState: ReturnType<typeof vi.fn>;
};
const { getOptionalAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  getOptionalAuth: ReturnType<typeof vi.fn>;
};
const { GET } = await import('@/app/api/v1/auth/oauth/[provider]/route');

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'g-id');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'g-secret');
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'gh-id');
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'gh-secret');
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
  vi.clearAllMocks();
  isOAuthProviderEnabled.mockReturnValue(true);
  getProvider.mockReturnValue({
    authorizeUrl: () => 'https://provider/authorize?state=mock-state-64char-' + 'a'.repeat(48),
    exchange: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
});

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('GET /api/v1/auth/oauth/[provider] — start handler', () => {
  it('happy: 302 + Set-Cookie + authorize URL', async () => {
    const req = makeRequest('/api/v1/auth/oauth/google?redirect=/jobs');
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://provider/authorize');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('oauth_state=mock-cookie.signed');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/api/v1/auth/oauth');
  });

  it('알 수 없는 provider → 404', async () => {
    const req = makeRequest('/api/v1/auth/oauth/foo');
    const res = await GET(req, { params: Promise.resolve({ provider: 'foo' }) });
    expect(res.status).toBe(404);
  });

  it('env 미설정 provider → 404 (enumeration 차단)', async () => {
    isOAuthProviderEnabled.mockReturnValue(false);
    const req = makeRequest('/api/v1/auth/oauth/google');
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.status).toBe(404);
  });

  it('redirect 부재 → "/" fallback (verify via state mock 호출 인자)', async () => {
    const state = await import('@/lib/auth/oauth/state');
    const mock = state.createOAuthState as ReturnType<typeof vi.fn>;
    const req = makeRequest('/api/v1/auth/oauth/google');
    await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(mock).toHaveBeenCalledWith(expect.objectContaining({ redirect: '/' }));
  });

  it('redirect=//evil.com (외부) → "/" fallback (open-redirect 차단)', async () => {
    const state = await import('@/lib/auth/oauth/state');
    const mock = state.createOAuthState as ReturnType<typeof vi.fn>;
    const req = makeRequest('/api/v1/auth/oauth/google?redirect=//evil.com/steal');
    await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(mock).toHaveBeenCalledWith(expect.objectContaining({ redirect: '/' }));
  });

  it('redirect=http://evil.com → "/" fallback', async () => {
    const state = await import('@/lib/auth/oauth/state');
    const mock = state.createOAuthState as ReturnType<typeof vi.fn>;
    const req = makeRequest('/api/v1/auth/oauth/google?redirect=http://evil.com');
    await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(mock).toHaveBeenCalledWith(expect.objectContaining({ redirect: '/' }));
  });

  it('redirect=/jobs/1 (내부 path) → 그대로 전달', async () => {
    const state = await import('@/lib/auth/oauth/state');
    const mock = state.createOAuthState as ReturnType<typeof vi.fn>;
    const req = makeRequest('/api/v1/auth/oauth/google?redirect=/jobs/1');
    await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(mock).toHaveBeenCalledWith(expect.objectContaining({ redirect: '/jobs/1' }));
  });

  // CANDID-024 Step 5 — link-add 모드.
  describe('mode=link', () => {
    it('인증 사용자 → state에 linkUserId 봉인 + redirect=/me/profile', async () => {
      getOptionalAuth.mockResolvedValue({ userId: 7 });
      const req = makeRequest('/api/v1/auth/oauth/google?mode=link');
      const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });

      expect(res.status).toBe(302);
      expect(createOAuthState).toHaveBeenCalledWith(
        expect.objectContaining({ linkUserId: 7, redirect: '/me/profile' }),
      );
    });

    it('미인증 → /login?redirect=/me/profile 302, state 미생성', async () => {
      getOptionalAuth.mockResolvedValue(null);
      const req = makeRequest('/api/v1/auth/oauth/google?mode=link');
      const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login');
      expect(res.headers.get('location')).toContain('redirect=%2Fme%2Fprofile');
      expect(createOAuthState).not.toHaveBeenCalled();
    });
  });
});
