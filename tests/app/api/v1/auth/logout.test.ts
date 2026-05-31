import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/cookies';
import { revokeRefreshSession } from '@/lib/auth/session';
import { POST } from '@/app/api/v1/auth/logout/route';

// session.ts(Prisma 의존)는 mock — route 핸들러의 Cookie 처리/멱등 응답만 검증.
// revokeRefreshSession 자체는 tests/lib/auth/session.test.ts에서 검증됨.
vi.mock('@/lib/auth/session', () => ({
  revokeRefreshSession: vi.fn(),
}));

const revoke = revokeRefreshSession as unknown as Mock;

beforeEach(() => {
  vi.resetAllMocks();
});

function logoutRequest(refreshToken?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (refreshToken !== undefined) {
    headers.cookie = `${REFRESH_COOKIE}=${refreshToken}`;
  }
  return new NextRequest('http://localhost/api/v1/auth/logout', { method: 'POST', headers });
}

/** 지정한 쿠키가 즉시 만료(Max-Age=0)로 클리어됐는지 확인. */
function expectCleared(response: Response, name: string): void {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (cookie === undefined) throw new Error(`Set-Cookie for "${name}" not found`);
  expect(cookie).toMatch(/Max-Age=0/i);
}

describe('POST /api/v1/auth/logout', () => {
  it('revokes the presented refresh session and clears both auth cookies with 200', async () => {
    revoke.mockResolvedValue(true);

    const response = await POST(logoutRequest('current-refresh-token'), undefined);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(revoke).toHaveBeenCalledWith('current-refresh-token');
    expectCleared(response, ACCESS_COOKIE);
    expectCleared(response, REFRESH_COOKIE);
  });

  it('is idempotent — clears cookies and returns 200 even with no refresh cookie (no revoke call)', async () => {
    const response = await POST(logoutRequest(), undefined);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(revoke).not.toHaveBeenCalled();
    expectCleared(response, ACCESS_COOKIE);
    expectCleared(response, REFRESH_COOKIE);
  });

  it('still clears cookies and returns 200 when the token is unknown/already revoked (revoke=false)', async () => {
    revoke.mockResolvedValue(false);

    const response = await POST(logoutRequest('stale-or-unknown-token'), undefined);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(revoke).toHaveBeenCalledWith('stale-or-unknown-token');
    expectCleared(response, ACCESS_COOKIE);
    expectCleared(response, REFRESH_COOKIE);
  });
});
