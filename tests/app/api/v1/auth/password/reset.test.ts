import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { __resetRateLimitStateForTesting, POLICIES } from '@/lib/security/rate-limit';

// CANDID-020 Step 4 — POST /api/v1/auth/password/reset 라우트 통합 테스트.
// 토큰 무효/만료 → AppError 매핑(400/410), 약한 비번/불일치 → zod 400, rate-limit 429.

vi.mock('@/lib/auth/password-reset', () => ({
  resetPassword: vi.fn(),
}));

const { resetPassword } = (await import('@/lib/auth/password-reset')) as unknown as {
  resetPassword: Mock;
};
const { POST } = await import('@/app/api/v1/auth/password/reset/route');

const TOKEN = 'd'.repeat(64);
const STRONG = 'NewPassw0rd!';

beforeEach(() => {
  vi.stubEnv('TRUST_PROXY', 'true');
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetRateLimitStateForTesting();
});

function postRequest(
  body: unknown = { token: TOKEN, password: STRONG, passwordConfirm: STRONG },
  ip = '203.0.113.60',
): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/auth/password/reset', () => {
  it('정상 — 200 + 재로그인 안내 (서비스 호출 인자 전달)', async () => {
    resetPassword.mockResolvedValueOnce({ userId: 7, revokedSessions: 2 });
    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toMatch(/다시 로그인/);
    expect(resetPassword).toHaveBeenCalledWith(TOKEN, STRONG);
  });

  it('무효 토큰 → 400 AUTH_RESET_TOKEN_INVALID', async () => {
    resetPassword.mockRejectedValueOnce(new AppError('AUTH_RESET_TOKEN_INVALID'));
    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('AUTH_RESET_TOKEN_INVALID');
  });

  it('만료 토큰 → 410 AUTH_RESET_TOKEN_EXPIRED', async () => {
    resetPassword.mockRejectedValueOnce(new AppError('AUTH_RESET_TOKEN_EXPIRED'));
    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(410);
    expect((await response.json()).code).toBe('AUTH_RESET_TOKEN_EXPIRED');
  });

  it('약한 비밀번호 → 400 (zod) + 서비스 미호출', async () => {
    const response = await POST(
      postRequest({ token: TOKEN, password: 'short', passwordConfirm: 'short' }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('비밀번호 확인 불일치 → 400 (zod) + 서비스 미호출', async () => {
    const response = await POST(
      postRequest({ token: TOKEN, password: STRONG, passwordConfirm: 'Different0!' }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('잘못된 토큰 형식(64-hex 아님) → 400 + 서비스 미호출', async () => {
    const response = await POST(
      postRequest({ token: 'not-hex', password: STRONG, passwordConfirm: STRONG }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('Rate Limit (POLICIES.PASSWORD_RESET) — N+1번째 429', async () => {
    const limit = POLICIES.PASSWORD_RESET.maxRequests;
    resetPassword.mockResolvedValue({ userId: 7, revokedSessions: 0 });
    for (let i = 0; i < limit; i++) {
      const ok = await POST(postRequest(undefined, '203.0.113.61'), undefined);
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(postRequest(undefined, '203.0.113.61'), undefined);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe('SYS_RATE_LIMITED');
  });
});
