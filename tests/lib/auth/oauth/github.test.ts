import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubOAuthProvider } from '@/lib/auth/oauth/github';
import { AppError } from '@/lib/errors';
import { mockFetchSequence } from './__test-helpers';

// CANDID-012 Step 2 — GitHub OAuth provider 단위 테스트.
// /user + /user/emails 2-call 패턴, primary+verified 선택, fallback 체인.

const ORIGINAL_FETCH = global.fetch;
const TOKEN_RESP = { access_token: 'gho_test', token_type: 'bearer' };
const USER_RESP = {
  id: 5550001,
  login: 'alice',
  name: 'Alice K',
  email: null,
  avatar_url: 'https://avatars.githubusercontent.com/u/5550001',
};

beforeEach(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-github-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-github-client-secret';
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
});

describe('githubOAuthProvider.authorizeUrl', () => {
  it('필수 OAuth2 + PKCE 파라미터 (scope=read:user user:email, S256)', () => {
    const url = githubOAuthProvider.authorizeUrl({
      state: 'g'.repeat(64),
      codeChallenge: 'ch',
      redirectUri: 'https://app.example.com/cb',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('test-github-client-id');
    expect(u.searchParams.get('scope')).toBe('read:user user:email');
    expect(u.searchParams.get('state')).toBe('g'.repeat(64));
    expect(u.searchParams.get('code_challenge')).toBe('ch');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('githubOAuthProvider.exchange — email 선택 로직', () => {
  async function run(emails: unknown): Promise<ReturnType<typeof githubOAuthProvider.exchange> extends Promise<infer T> ? T : never> {
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: USER_RESP },
      { ok: true, json: emails },
    ]) as unknown as typeof fetch;
    return githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });
  }

  it('primary+verified 우선 → lowercase 정규화', async () => {
    const p = await run([
      { email: 'other@example.com', primary: false, verified: true },
      { email: 'Alice@Example.COM', primary: true, verified: true },
    ]);
    expect(p.email).toBe('alice@example.com');
    expect(p.emailVerified).toBe(true);
    expect(p.providerUserId).toBe('5550001');
    expect(p.name).toBe('Alice K');
    expect(p.profileImageUrl).toBe('https://avatars.githubusercontent.com/u/5550001');
  });

  it('primary unverified → verified 첫 항목 fallback', async () => {
    const p = await run([
      { email: 'unverified@x.com', primary: true, verified: false },
      { email: 'secondary@x.com', primary: false, verified: true },
    ]);
    expect(p.email).toBe('secondary@x.com');
    expect(p.emailVerified).toBe(true);
  });

  it('모두 unverified 또는 빈 배열 → email=null, emailVerified=false', async () => {
    const allUnverified = await run([
      { email: 'a@x.com', primary: true, verified: false },
      { email: 'b@x.com', primary: false, verified: false },
    ]);
    expect(allUnverified.email).toBeNull();
    expect(allUnverified.emailVerified).toBe(false);

    const empty = await run([]);
    expect(empty.email).toBeNull();
  });

  it('emails 응답이 배열 아님 → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    await expect(run({ error: 'forbidden' })).rejects.toMatchObject({
      code: 'AUTH_OAUTH_PROVIDER_ERROR',
    });
  });
});

describe('githubOAuthProvider.exchange — name fallback 체인', () => {
  it('name → login → email local-part → providerUserId 순', async () => {
    // login fallback
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { id: 1, login: 'bob_handle', name: null, avatar_url: null } },
      { ok: true, json: [{ email: 'bob@x.com', primary: true, verified: true }] },
    ]) as unknown as typeof fetch;
    let p = await githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });
    expect(p.name).toBe('bob_handle');

    // email local-part fallback (login null)
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { id: 2, login: null, name: null, avatar_url: null } },
      { ok: true, json: [{ email: 'carol@x.com', primary: true, verified: true }] },
    ]) as unknown as typeof fetch;
    p = await githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });
    expect(p.name).toBe('carol');

    // 모든 fallback 실패 → '소셜 사용자' (review fix: id 노출 차단)
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { id: 999, login: null, name: null, avatar_url: null } },
      { ok: true, json: [] },
    ]) as unknown as typeof fetch;
    p = await githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });
    expect(p.name).toBe('소셜 사용자');
    expect(p.profileImageUrl).toBeNull();
  });

  it('avatar_url이 비-https → null (review fix: 스킴 검증)', async () => {
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { id: 7, login: 'x', name: 'X', avatar_url: 'http://insecure.example/avatar.jpg' } },
      { ok: true, json: [{ email: 'x@y.com', primary: true, verified: true }] },
    ]) as unknown as typeof fetch;
    const p = await githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });
    expect(p.profileImageUrl).toBeNull();
  });
});

describe('githubOAuthProvider.exchange — 실패 경로', () => {
  it('user 응답 id 누락 / token access_token 누락 → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    global.fetch = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: { login: 'x' } },
    ]) as unknown as typeof fetch;
    await expect(
      githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
    ).rejects.toBeInstanceOf(AppError);

    global.fetch = mockFetchSequence([
      { ok: true, json: { error: 'bad_verification_code' } },
    ]) as unknown as typeof fetch;
    await expect(
      githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
  });

  it('token endpoint Accept: application/json + User-Agent 헤더 전송', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: TOKEN_RESP },
      { ok: true, json: USER_RESP },
      { ok: true, json: [{ email: 'a@b.com', primary: true, verified: true }] },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' });

    const tokenInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = tokenInit?.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toContain('candidate-web');
  });

  it('client_id/secret 미설정 → AUTH_OAUTH_PROVIDER_ERROR', async () => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    const env = await import('@/lib/env');
    env.__resetCachedEnvForTesting();
    try {
      await expect(
        githubOAuthProvider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
      ).rejects.toMatchObject({ code: 'AUTH_OAUTH_PROVIDER_ERROR' });
    } finally {
      env.__resetCachedEnvForTesting();
    }
  });
});
