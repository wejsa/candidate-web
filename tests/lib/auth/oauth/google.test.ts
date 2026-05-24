import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { googleOAuthProvider } from '@/lib/auth/oauth/google';
import { AppError } from '@/lib/errors';
import { mockFetchSequence } from './__test-helpers';

// CANDID-012 Step 2 — Google OAuth provider 단위 테스트.

const ORIGINAL_FETCH = global.fetch;
const TOKEN_RESP = { access_token: 'gha_test', token_type: 'Bearer' };
const USERINFO = {
  sub: '108234567890',
  email: 'Alice@Example.COM',
  email_verified: true,
  name: 'Alice Kim',
  picture: 'https://lh3.googleusercontent.com/a/alice.jpg',
};

beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret';
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
});

describe('googleOAuthProvider.authorizeUrl', () => {
  it('필수 OAuth2 + PKCE 파라미터 (scope=openid profile email, S256)', () => {
    const url = googleOAuthProvider.authorizeUrl({
      state: 'a'.repeat(64),
      codeChallenge: 'challenge_b64url',
      redirectUri: 'https://app.example.com/api/v1/auth/oauth/google/callback',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/v1/auth/oauth/google/callback',
    );
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid profile email');
    expect(u.searchParams.get('state')).toBe('a'.repeat(64));
    expect(u.searchParams.get('code_challenge')).toBe('challenge_b64url');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('googleOAuthProvider.exchange', () => {
  it('happy: token + userinfo → 정규화 프로필 (lowercase email + emailVerified)', async () => {
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: USERINFO },
    ]) as unknown as typeof fetch;

    const profile = await googleOAuthProvider.exchange({
      code: 'auth_code_xyz',
      codeVerifier: 'verifier_b64url',
      redirectUri: 'https://app.example.com/cb',
    });

    expect(profile).toEqual({
      providerUserId: '108234567890',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice Kim',
      profileImageUrl: 'https://lh3.googleusercontent.com/a/alice.jpg',
    });
  });

  it('email_verified=false → emailVerified=false (지원서 제출 시 BR-AUTH-04 차단됨)', async () => {
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { ...USERINFO, email_verified: false } },
    ]) as unknown as typeof fetch;
    const p = await googleOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });
    expect(p.emailVerified).toBe(false);
  });

  it('email/picture 부재 → null + name=email local-part 또는 sub fallback', async () => {
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { sub: '222', email: 'bob@example.com', email_verified: true } },
    ]) as unknown as typeof fetch;
    const p = await googleOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });
    expect(p.name).toBe('bob');
    expect(p.profileImageUrl).toBeNull();
  });

  it('email 자체 부재 → email=null, name=sub fallback', async () => {
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { sub: '999' } },
    ]) as unknown as typeof fetch;
    const p = await googleOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });
    expect(p.email).toBeNull();
    expect(p.name).toBe('999');
  });

  it('token endpoint 5xx → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    global.fetch = mockFetchSequence([{ ok: false, status: 500 }]) as unknown as typeof fetch;
    await expect(
      googleOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
  });

  it('token 응답에 access_token 누락 / userinfo에 sub 누락 → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    global.fetch = mockFetchSequence([{ ok: true, json: { token_type: 'Bearer' } }]) as unknown as typeof fetch;
    await expect(
      googleOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
    ).rejects.toBeInstanceOf(AppError);

    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { email: 'x@y.com' } },
    ]) as unknown as typeof fetch;
    await expect(
      googleOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
  });

  it('client_id/secret 미설정 시 throw (defense-in-depth, index.ts getProvider와 별도)', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const env = await import('@/lib/env');
    env.__resetCachedEnvForTesting();
    try {
      await expect(
        googleOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
      ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
    } finally {
      env.__resetCachedEnvForTesting();
    }
  });

  it('POST body에 PKCE + grant_type + client_id 포함; userinfo에 Bearer 헤더', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: 'TOKEN_XYZ', token_type: 'Bearer' } },
      { ok: true, json: USERINFO },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await googleOAuthProvider.exchange({
      code: 'auth_code_42',
      codeVerifier: 'verifier_42',
      redirectUri: 'https://x.example.com/cb',
    });

    const tokenInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = String(tokenInit?.body ?? '');
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=auth_code_42');
    expect(body).toContain('code_verifier=verifier_42');
    expect(body).toContain('client_id=test-google-client-id');
    expect(body).toContain('client_secret=test-google-client-secret');

    const userinfoInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect((userinfoInit?.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN_XYZ');
  });
});
