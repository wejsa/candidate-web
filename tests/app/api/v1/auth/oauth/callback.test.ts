import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { __resetRateLimitStateForTesting } from '@/lib/security/rate-limit';

// CANDID-012 Step 3 — GET /api/v1/auth/oauth/{provider}/callback 라우터 테스트.
// state.verify + provider.exchange + linkOrCreateOAuthUser 모두 mock.
// 라우터는 분기 처리(302 success / 302 /login?error= / 404) + state 쿠키 즉시 소멸만 검증.

vi.mock('@/lib/auth/oauth/state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/oauth/state')>(
    '@/lib/auth/oauth/state',
  );
  return {
    ...actual,
    verifyOAuthStateCookie: vi.fn(),
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
vi.mock('@/lib/auth/oauth/link', () => ({
  linkOrCreateOAuthUser: vi.fn(),
}));

const { verifyOAuthStateCookie } = (await import('@/lib/auth/oauth/state')) as unknown as {
  verifyOAuthStateCookie: ReturnType<typeof vi.fn>;
};
const { isOAuthProviderEnabled, getProvider } = (await import(
  '@/lib/auth/oauth'
)) as unknown as {
  isOAuthProviderEnabled: ReturnType<typeof vi.fn>;
  getProvider: ReturnType<typeof vi.fn>;
};
const { linkOrCreateOAuthUser } = (await import('@/lib/auth/oauth/link')) as unknown as {
  linkOrCreateOAuthUser: ReturnType<typeof vi.fn>;
};
const { GET } = await import('@/app/api/v1/auth/oauth/[provider]/callback/route');

const happyProfile = {
  providerUserId: 'g-1',
  email: 'a@b.com',
  emailVerified: true,
  name: 'A',
  profileImageUrl: null,
};
const happyLinkResult = {
  user: { id: 1, email: 'a@b.com', name: 'A', emailVerifiedAt: new Date('2026-05-24') },
  tokens: {
    accessToken: 'a-jwt',
    accessExpiresAt: new Date('2026-06-01T00:00:00Z'),
    refreshToken: 'r-jwt',
    refreshExpiresAt: new Date('2026-06-15T00:00:00Z'),
  },
  linkAction: 'signin' as const,
};

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
    authorizeUrl: () => 'unused',
    exchange: vi.fn(async () => happyProfile),
  });
  verifyOAuthStateCookie.mockReturnValue({
    provider: 'google',
    redirect: '/jobs',
    codeVerifier: 'v',
  });
  linkOrCreateOAuthUser.mockResolvedValue(happyLinkResult);
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
});

function makeRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(path, 'http://localhost:3000'));
  for (const [k, v] of Object.entries(cookies)) {
    req.cookies.set(k, v);
  }
  return req;
}

describe('GET /api/v1/auth/oauth/[provider]/callback — happy', () => {
  it('정상 흐름: 302 to sanitized redirect + access/refresh + state cookie 소멸', async () => {
    const req = makeRequest('/api/v1/auth/oauth/google/callback?code=ABC&state=XYZ', {
      oauth_state: 'cookie.signed',
    });
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/jobs');

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('access_token=a-jwt');
    expect(setCookie).toContain('refresh_token=r-jwt');
    // state cookie 즉시 소멸 (Max-Age=0)
    expect(setCookie).toMatch(/oauth_state=;[^,]*Max-Age=0/);
  });
});

describe('callback — 실패 경로 (모두 /login?error=로 302)', () => {
  it('알 수 없는 provider → 404', async () => {
    const req = makeRequest('/api/v1/auth/oauth/foo/callback');
    const res = await GET(req, { params: Promise.resolve({ provider: 'foo' }) });
    expect(res.status).toBe(404);
  });

  it('provider error=access_denied → /login?error=oauth_user_denied', async () => {
    const req = makeRequest(
      '/api/v1/auth/oauth/google/callback?error=access_denied&error_description=user+denied',
    );
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/login\?error=oauth_user_denied/);
  });

  it('state 검증 실패 → /login?error=oauth_state_invalid + cookie 소멸', async () => {
    verifyOAuthStateCookie.mockImplementation(() => {
      throw new AppError('AUTH_OAUTH_STATE_INVALID');
    });
    const req = makeRequest('/api/v1/auth/oauth/google/callback?code=A&state=tampered');
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/oauth_state_invalid/);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/oauth_state=;[^,]*Max-Age=0/);
  });

  it('code 부재 → /login?error=oauth_state_invalid', async () => {
    const req = makeRequest('/api/v1/auth/oauth/google/callback?state=XYZ');
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.headers.get('location')).toMatch(/oauth_state_invalid/);
  });

  it('provider.exchange 실패 → /login?error=oauth_provider_error', async () => {
    getProvider.mockReturnValue({
      authorizeUrl: () => 'unused',
      exchange: vi.fn(async () => {
        throw new AppError('AUTH_OAUTH_PROVIDER_ERROR');
      }),
    });
    const req = makeRequest('/api/v1/auth/oauth/google/callback?code=A&state=X');
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.headers.get('location')).toMatch(/oauth_provider_error/);
  });

  it('linkOrCreateOAuthUser → AUTH_OAUTH_EMAIL_TAKEN → /login?error=oauth_email_taken (BR-AUTH-06)', async () => {
    linkOrCreateOAuthUser.mockRejectedValueOnce(new AppError('AUTH_OAUTH_EMAIL_TAKEN'));
    const req = makeRequest('/api/v1/auth/oauth/google/callback?code=A&state=X');
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.headers.get('location')).toMatch(/oauth_email_taken/);
  });

  it('linkOrCreateOAuthUser → AUTH_INVALID_CREDENTIALS (비활성 사용자) → /login?error=oauth_account_inactive', async () => {
    linkOrCreateOAuthUser.mockRejectedValueOnce(new AppError('AUTH_INVALID_CREDENTIALS'));
    const req = makeRequest('/api/v1/auth/oauth/google/callback?code=A&state=X');
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.headers.get('location')).toMatch(/oauth_account_inactive/);
  });
});

describe('callback — 통합 단정', () => {
  it('verifyOAuthStateCookie 호출 시 URL provider param 전달', async () => {
    const req = makeRequest('/api/v1/auth/oauth/github/callback?code=A&state=X', {
      oauth_state: 'c.v',
    });
    await GET(req, { params: Promise.resolve({ provider: 'github' }) });
    expect(verifyOAuthStateCookie).toHaveBeenCalledWith('c.v', 'X', 'github');
  });

  it('exchange 성공 후 linkOrCreateOAuthUser에 provider 전달', async () => {
    const req = makeRequest('/api/v1/auth/oauth/google/callback?code=A&state=X');
    await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(linkOrCreateOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', profile: happyProfile }),
    );
  });
});
