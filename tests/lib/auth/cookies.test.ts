import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  readAuthCookies,
  setAuthCookies,
} from '@/lib/auth/cookies';
import type { AuthTokenPair } from '@/lib/auth/cookies';

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
});

const ACCESS_EXPIRES = new Date('2026-06-01T00:00:00Z');
const REFRESH_EXPIRES = new Date('2026-06-15T00:00:00Z');

function fakeTokens(): AuthTokenPair {
  return {
    access: { token: 'fake-access-jwt-value', expiresAt: ACCESS_EXPIRES },
    refresh: { token: 'fake-refresh-jwt-value', expiresAt: REFRESH_EXPIRES },
  };
}

function setCookieFor(response: NextResponse, name: string): string {
  const found = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (found === undefined) throw new Error(`Set-Cookie for "${name}" not found`);
  return found;
}

function cookieValue(raw: string, name: string): string {
  return raw.slice(name.length + 1).split(';')[0] ?? '';
}

describe('setAuthCookies', () => {
  it('writes both access and refresh token cookies with their values', () => {
    const res = NextResponse.json({ ok: true });
    setAuthCookies(res, fakeTokens());

    expect(cookieValue(setCookieFor(res, ACCESS_COOKIE), ACCESS_COOKIE)).toBe(
      'fake-access-jwt-value',
    );
    expect(cookieValue(setCookieFor(res, REFRESH_COOKIE), REFRESH_COOKIE)).toBe(
      'fake-refresh-jwt-value',
    );
  });

  it('marks both cookies HttpOnly, SameSite=Lax, Path=/', () => {
    const res = NextResponse.json({ ok: true });
    setAuthCookies(res, fakeTokens());

    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      const raw = setCookieFor(res, name);
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Lax/i);
      expect(raw).toMatch(/Path=\//i);
    }
  });

  it('does not set Secure in non-production env (로컬 http 개발 허용)', () => {
    const res = NextResponse.json({ ok: true });
    setAuthCookies(res, fakeTokens());
    expect(setCookieFor(res, ACCESS_COOKIE)).not.toMatch(/Secure/i);
  });

  it('sets Secure on both cookies in production', () => {
    __resetCachedEnvForTesting();
    vi.stubEnv('NODE_ENV', 'production');

    const res = NextResponse.json({ ok: true });
    setAuthCookies(res, fakeTokens());

    expect(setCookieFor(res, ACCESS_COOKIE)).toMatch(/Secure/i);
    expect(setCookieFor(res, REFRESH_COOKIE)).toMatch(/Secure/i);
  });

  it('sets each cookie Expires to its own token expiry', () => {
    const res = NextResponse.json({ ok: true });
    setAuthCookies(res, fakeTokens());

    expect(setCookieFor(res, ACCESS_COOKIE)).toContain(
      `Expires=${ACCESS_EXPIRES.toUTCString()}`,
    );
    expect(setCookieFor(res, REFRESH_COOKIE)).toContain(
      `Expires=${REFRESH_EXPIRES.toUTCString()}`,
    );
  });
});

describe('clearAuthCookies', () => {
  it('emits both auth cookies emptied with Max-Age=0', () => {
    const res = NextResponse.json({ ok: true });
    clearAuthCookies(res);

    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      const raw = setCookieFor(res, name);
      expect(cookieValue(raw, name)).toBe('');
      expect(raw).toMatch(/Max-Age=0/i);
    }
  });
});

describe('readAuthCookies', () => {
  it('extracts both token values from the request cookie header', () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: { cookie: `${ACCESS_COOKIE}=AAA; ${REFRESH_COOKIE}=BBB` },
    });
    expect(readAuthCookies(req)).toEqual({ accessToken: 'AAA', refreshToken: 'BBB' });
  });

  it('returns null for both when no cookies are present', () => {
    const req = new NextRequest('http://localhost/api/test');
    expect(readAuthCookies(req)).toEqual({ accessToken: null, refreshToken: null });
  });

  it('returns null only for the missing cookie when one is present', () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: { cookie: `${ACCESS_COOKIE}=only-access` },
    });
    expect(readAuthCookies(req)).toEqual({ accessToken: 'only-access', refreshToken: null });
  });
});
