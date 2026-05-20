import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/cookies';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { rotateRefreshSession } from '@/lib/auth/session';
import { POST } from '@/app/api/v1/auth/refresh/route';

// session.ts(Prisma 의존)는 mock — route 핸들러의 Cookie 처리/응답 매핑만 검증.
// rotateRefreshSession 자체는 tests/lib/auth/session.test.ts에서 검증됨.
vi.mock('@/lib/auth/session', () => ({
  rotateRefreshSession: vi.fn(),
}));

const rotate = rotateRefreshSession as unknown as Mock;

const USER_ID = 88;

beforeEach(() => {
  vi.resetAllMocks();
});

function refreshRequest(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.cookie = `${REFRESH_COOKIE}=${token}`;
  }
  return new NextRequest('http://localhost/api/v1/auth/refresh', { method: 'POST', headers });
}

function setCookieValue(response: Response, name: string): string {
  const found = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (found === undefined) throw new Error(`Set-Cookie for "${name}" not found`);
  return found.slice(name.length + 1).split(';')[0] ?? '';
}

describe('POST /api/v1/auth/refresh', () => {
  it('returns 401 AUTH_REFRESH_INVALID when no refresh cookie is present', async () => {
    const response = await POST(refreshRequest(), undefined);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'AUTH_REFRESH_INVALID', status: 401 });
    // withErrorHandler 표준 에러 응답 — 7필드 traceId 포함 확인
    expect(typeof body.traceId).toBe('string');
    expect(rotate).not.toHaveBeenCalled();
  });

  it('returns 401 AUTH_REFRESH_INVALID when rotation reports invalid', async () => {
    rotate.mockResolvedValue({ ok: false, reason: 'invalid' });
    const response = await POST(refreshRequest('stale-token'), undefined);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('returns 401 AUTH_REFRESH_INVALID when rotation reports revoked', async () => {
    rotate.mockResolvedValue({ ok: false, reason: 'revoked' });
    const response = await POST(refreshRequest('revoked-token'), undefined);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('returns 401 AUTH_REFRESH_EXPIRED when rotation reports expired', async () => {
    rotate.mockResolvedValue({ ok: false, reason: 'expired' });
    const response = await POST(refreshRequest('expired-token'), undefined);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'AUTH_REFRESH_EXPIRED' });
  });

  it('rotates the session and sets fresh access + refresh cookies on success', async () => {
    rotate.mockResolvedValue({
      ok: true,
      session: {
        token: 'new-refresh-jwt-value',
        expiresAt: new Date('2026-07-01T00:00:00Z'),
        userId: USER_ID,
        familyId: '33333333-3333-4333-8333-333333333333',
        rotationCounter: 4,
      },
    });

    const response = await POST(refreshRequest('current-refresh-token'), undefined);

    expect(response.status).toBe(200);
    expect(typeof (await response.json()).accessExpiresAt).toBe('string');
    expect(rotate).toHaveBeenCalledWith('current-refresh-token');
    expect(setCookieValue(response, REFRESH_COOKIE)).toBe('new-refresh-jwt-value');
    expect(setCookieValue(response, ACCESS_COOKIE).split('.')).toHaveLength(3);
  });

  it('issues the new access token for the rotated session owner', async () => {
    rotate.mockResolvedValue({
      ok: true,
      session: {
        token: 'rotated-refresh',
        expiresAt: new Date('2026-07-01T00:00:00Z'),
        userId: USER_ID,
        familyId: '44444444-4444-4444-8444-444444444444',
        rotationCounter: 1,
      },
    });

    const response = await POST(refreshRequest('current'), undefined);
    const verified = await verifyAccessToken(setCookieValue(response, ACCESS_COOKIE));
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error('expected ok');
    expect(verified.claims.userId).toBe(USER_ID);
  });
});
