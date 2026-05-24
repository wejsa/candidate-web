import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProvider, isOAuthProviderEnabled } from '@/lib/auth/oauth';
import { AppError } from '@/lib/errors';

// CANDID-012 Step 2 review fix (T-MAJOR-1) — index.ts factory + helper 단위 테스트.
// Step 3 라우터의 분기 SSOT이므로 회귀 가드가 필수.

beforeEach(async () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = '';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = '';
  process.env.GITHUB_OAUTH_CLIENT_ID = '';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = '';
  const env = await import('@/lib/env');
  env.__resetCachedEnvForTesting();
});

afterEach(async () => {
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const env = await import('@/lib/env');
  env.__resetCachedEnvForTesting();
});

describe('isOAuthProviderEnabled', () => {
  it('양 env 채워짐 → true', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'g-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'g-secret';
    const env = await import('@/lib/env');
    env.__resetCachedEnvForTesting();
    expect(isOAuthProviderEnabled('google')).toBe(true);
  });

  it('양 env 비어있음 → false', () => {
    expect(isOAuthProviderEnabled('google')).toBe(false);
    expect(isOAuthProviderEnabled('github')).toBe(false);
  });

  it('한 provider만 활성화 → 해당 provider만 true', async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'gh-id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'gh-secret';
    const env = await import('@/lib/env');
    env.__resetCachedEnvForTesting();
    expect(isOAuthProviderEnabled('google')).toBe(false);
    expect(isOAuthProviderEnabled('github')).toBe(true);
  });
});

describe('getProvider', () => {
  it('Google 활성 → googleOAuthProvider 반환 (authorizeUrl 호출 가능)', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'g-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'g-secret';
    const env = await import('@/lib/env');
    env.__resetCachedEnvForTesting();
    const provider = getProvider('google');
    expect(provider).toBeDefined();
    expect(typeof provider.authorizeUrl).toBe('function');
    expect(typeof provider.exchange).toBe('function');
  });

  it('GitHub 활성 → githubOAuthProvider 반환', async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'gh-id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'gh-secret';
    const env = await import('@/lib/env');
    env.__resetCachedEnvForTesting();
    const provider = getProvider('github');
    expect(provider).toBeDefined();
  });

  it('env 미설정 (google) → AUTH_OAUTH_PROVIDER_ERROR throw', () => {
    expect(() => getProvider('google')).toThrow(AppError);
    try {
      getProvider('google');
    } catch (err) {
      expect((err as AppError).code).toBe('AUTH_OAUTH_PROVIDER_ERROR');
    }
  });

  it('env 미설정 (github) → AUTH_OAUTH_PROVIDER_ERROR throw', () => {
    expect(() => getProvider('github')).toThrow(AppError);
  });

  it('두 provider 모두 화이트리스트 분기 통과 (defense-in-depth)', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'g';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'g';
    process.env.GITHUB_OAUTH_CLIENT_ID = 'gh';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'gh';
    const env = await import('@/lib/env');
    env.__resetCachedEnvForTesting();
    expect(() => getProvider('google')).not.toThrow();
    expect(() => getProvider('github')).not.toThrow();
  });
});
