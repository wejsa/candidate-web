import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueAccessToken, issueRefreshToken } from '@/lib/auth/jwt';
import { getOptionalAuth, requireAuth } from '@/lib/auth/middleware';

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

  it('returns 401 AUTH_TOKEN_INVALID when no access cookie is present', async () => {
    const result = await requireAuth(requestWithAccessCookie());
    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error('expected NextResponse');
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ status: 401, code: 'AUTH_TOKEN_INVALID' });
  });

  it('returns 401 AUTH_TOKEN_EXPIRED for an expired access token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'));
    const { token } = await issueAccessToken(USER_ID);
    vi.setSystemTime(new Date('2026-05-20T00:31:00Z'));

    const result = await requireAuth(requestWithAccessCookie(token));
    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error('expected NextResponse');
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
  });

  it('returns 401 AUTH_TOKEN_INVALID for a malformed access token', async () => {
    const result = await requireAuth(requestWithAccessCookie('not-a-jwt'));
    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error('expected NextResponse');
    expect(await result.json()).toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
  });

  it('rejects a refresh token presented in the access cookie slot', async () => {
    const { token } = await issueRefreshToken(USER_ID);
    const result = await requireAuth(requestWithAccessCookie(token));
    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error('expected NextResponse');
    expect(await result.json()).toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
  });

  it('includes timestamp and the request path in the error body', async () => {
    const result = await requireAuth(requestWithAccessCookie());
    if (!(result instanceof NextResponse)) throw new Error('expected NextResponse');
    const body = await result.json();
    expect(body.path).toBe('/api/v1/me');
    expect(typeof body.timestamp).toBe('string');
    expect(body.message).toMatch(/토큰/);
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
