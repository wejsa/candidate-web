import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueAccessToken, issueRefreshToken } from '@/lib/auth/jwt';
import { getOptionalAuth, requireAuth } from '@/lib/auth/middleware';
import { AppError } from '@/lib/errors';

afterEach(() => {
  vi.useRealTimers();
});

const USER_ID = 31;

function requestWithAccessCookie(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.cookie = `access_token=${token}`;
  }
  return new NextRequest('http://localhost/api/v1/me', { headers });
}

describe('requireAuth', () => {
  it('returns AuthContext for a valid access token', async () => {
    const { token } = await issueAccessToken(USER_ID);
    expect(await requireAuth(requestWithAccessCookie(token))).toEqual({ userId: USER_ID });
  });

  it('throws AUTH_TOKEN_INVALID AppError when no access cookie is present', async () => {
    await expect(requireAuth(requestWithAccessCookie())).rejects.toBeInstanceOf(AppError);
    await expect(requireAuth(requestWithAccessCookie())).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
      status: 401,
      message: '인증 토큰이 없습니다.',
    });
  });

  it('throws AUTH_TOKEN_EXPIRED for an expired access token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
    const { token } = await issueAccessToken(USER_ID);
    vi.setSystemTime(new Date('2026-05-20T00:31:00Z'));

    await expect(requireAuth(requestWithAccessCookie(token))).rejects.toMatchObject({
      code: 'AUTH_TOKEN_EXPIRED',
      status: 401,
    });
  });

  it('throws AUTH_TOKEN_INVALID for a malformed access token', async () => {
    await expect(requireAuth(requestWithAccessCookie('not-a-jwt'))).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('rejects a refresh token presented in the access cookie slot', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    await expect(requireAuth(requestWithAccessCookie(token))).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });
});

describe('getOptionalAuth', () => {
  it('returns AuthContext for a valid access token', async () => {
    const { token } = await issueAccessToken(USER_ID);
    expect(await getOptionalAuth(requestWithAccessCookie(token))).toEqual({ userId: USER_ID });
  });

  it('returns null when no access cookie is present', async () => {
    expect(await getOptionalAuth(requestWithAccessCookie())).toBeNull();
  });

  it('returns null for a malformed access token', async () => {
    expect(await getOptionalAuth(requestWithAccessCookie('garbage'))).toBeNull();
  });

  it('returns null for an expired access token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
    const { token } = await issueAccessToken(USER_ID);
    vi.setSystemTime(new Date('2026-05-20T01:00:00Z'));
    expect(await getOptionalAuth(requestWithAccessCookie(token))).toBeNull();
  });
});
