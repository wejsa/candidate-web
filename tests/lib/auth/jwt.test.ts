import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import {
  __resetCachedSecretsForTesting,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '@/lib/auth/jwt';

// 캐시(secret/env) + fake timer를 매 테스트 후 초기화 — 토큰 만료/회전 케이스 격리.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __resetCachedSecretsForTesting();
  __resetCachedEnvForTesting();
});

const USER_ID = 42;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('issueAccessToken / issueRefreshToken', () => {
  it('issues an access token expiring ~30분 후 (JWT_ACCESS_TTL_SEC 기본 1800)', async () => {
    const before = Date.now();
    const { token, expiresAt } = await issueAccessToken(USER_ID);
    expect(token.split('.')).toHaveLength(3);
    const ttlMs = expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(1790_000);
    expect(ttlMs).toBeLessThanOrEqual(1801_000);
  });

  it('issues a refresh token expiring ~14일 후 by default (rememberMe 미지정)', async () => {
    const before = Date.now();
    const { expiresAt } = await issueRefreshToken(USER_ID);
    const ttlSec = Math.round((expiresAt.getTime() - before) / 1000);
    expect(ttlSec).toBeGreaterThan(1209590);
    expect(ttlSec).toBeLessThanOrEqual(1209600);
  });

  it('issues a short-lived refresh token (~1일) when rememberMe is false', async () => {
    const before = Date.now();
    const { expiresAt } = await issueRefreshToken(USER_ID, { rememberMe: false });
    const ttlSec = Math.round((expiresAt.getTime() - before) / 1000);
    expect(ttlSec).toBeGreaterThan(86390);
    expect(ttlSec).toBeLessThanOrEqual(86400);
  });

  it('issues a 14일 refresh token when rememberMe is explicitly true', async () => {
    const { expiresAt } = await issueRefreshToken(USER_ID, { rememberMe: true });
    const ttlSec = Math.round((expiresAt.getTime() - Date.now()) / 1000);
    expect(ttlSec).toBeGreaterThan(86400);
  });

  it('produces distinct tokens for back-to-back issues (random jti)', async () => {
    const a = await issueAccessToken(USER_ID);
    const b = await issueAccessToken(USER_ID);
    expect(a.token).not.toBe(b.token);
  });
});

describe('verifyAccessToken / verifyRefreshToken — happy path', () => {
  it('verifies a freshly issued access token and returns claims', async () => {
    const { token } = await issueAccessToken(USER_ID);
    const result = await verifyAccessToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.claims.userId).toBe(USER_ID);
    expect(result.claims.tokenType).toBe('access');
    expect(result.claims.jti).toMatch(UUID_RE);
    expect(result.claims.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('verifies a freshly issued refresh token and returns tokenType refresh', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    const result = await verifyRefreshToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.claims.userId).toBe(USER_ID);
    expect(result.claims.tokenType).toBe('refresh');
  });
});

describe('verifyToken — cross-type rejection', () => {
  it('rejects a refresh token passed to verifyAccessToken', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    expect(await verifyAccessToken(token)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects an access token passed to verifyRefreshToken', async () => {
    const { token } = await issueAccessToken(USER_ID);
    expect(await verifyRefreshToken(token)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('verifyToken — malformed / tampered input', () => {
  it.each([
    ['empty string', ''],
    ['non-jwt garbage', 'not-a-jwt'],
    ['two-segment token', 'header.payload'],
  ])('rejects %s as invalid', async (_label, bad) => {
    expect(await verifyAccessToken(bad)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a token with a tampered signature', async () => {
    const { token } = await issueAccessToken(USER_ID);
    const [h, p] = token.split('.');
    const forged = `${h}.${p}.${'A'.repeat(86)}`;
    expect(await verifyAccessToken(forged)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a token with a tampered payload (signature mismatch)', async () => {
    const { token } = await issueAccessToken(USER_ID);
    const [h, , s] = token.split('.');
    const otherPayload = Buffer.from(JSON.stringify({ sub: '999', tokenType: 'access' })).toString(
      'base64url',
    );
    expect(await verifyAccessToken(`${h}.${otherPayload}.${s}`)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('verifyToken — expiry', () => {
  it('returns reason "expired" once the access token TTL has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
    const { token } = await issueAccessToken(USER_ID);

    // TTL 1800초 경과 후 (+31분)
    vi.setSystemTime(new Date('2026-05-20T00:31:00Z'));
    expect(await verifyAccessToken(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('still verifies a token just before its expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
    const { token } = await issueAccessToken(USER_ID);

    vi.setSystemTime(new Date('2026-05-20T00:29:00Z'));
    expect((await verifyAccessToken(token)).ok).toBe(true);
  });
});

describe('verifyToken — secret rotation', () => {
  it('rejects a previously valid token after the signing secret rotates', async () => {
    const { token } = await issueAccessToken(USER_ID);
    expect((await verifyAccessToken(token)).ok).toBe(true);

    vi.stubEnv('JWT_ACCESS_SECRET', `rotated-access-secret-${'z'.repeat(50)}`);
    __resetCachedSecretsForTesting();
    __resetCachedEnvForTesting();

    expect(await verifyAccessToken(token)).toEqual({ ok: false, reason: 'invalid' });
  });
});
