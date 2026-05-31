// CANDID-024 Step 4 — DELETE /api/v1/users/me/providers/{provider} 통합 테스트.
// requireAuth + unlinkProvider mock으로 배선/provider 화이트리스트/에러 변환 검증.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/auth/oauth/unlink', () => ({ unlinkProvider: vi.fn() }));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { unlinkProvider } = (await import('@/lib/auth/oauth/unlink')) as unknown as {
  unlinkProvider: Mock;
};
const { DELETE } = await import('@/app/api/v1/users/me/providers/[provider]/route');

beforeEach(() => {
  __resetCachedEnvForTesting();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function delRequest(): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/users/me/providers/google', {
    method: 'DELETE',
    headers: { 'user-agent': 'vitest-ua' },
  });
}

function ctx(provider: string): { params: Promise<{ provider: string }> } {
  return { params: Promise.resolve({ provider }) };
}

describe('DELETE /api/v1/users/me/providers/{provider}', () => {
  it('204 + unlinkProvider 호출 (provider 전파)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    unlinkProvider.mockResolvedValueOnce(undefined);

    const res = await DELETE(delRequest(), ctx('google'));

    expect(res.status).toBe(204);
    expect(unlinkProvider).toHaveBeenCalledWith({
      userId: 42,
      provider: 'google',
      userAgent: 'vitest-ua',
      ipAddress: null,
    });
  });

  it('화이트리스트 외 provider → 404, unlinkProvider 미호출', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });

    const res = await DELETE(delRequest(), ctx('kakao'));

    expect(res.status).toBe(404);
    expect(unlinkProvider).not.toHaveBeenCalled();
  });

  it('마지막 인증수단 → 409 USER_LAST_AUTH_METHOD', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    unlinkProvider.mockRejectedValueOnce(new AppError('USER_LAST_AUTH_METHOD'));

    const res = await DELETE(delRequest(), ctx('google'));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('USER_LAST_AUTH_METHOD');
  });

  it('미연결 provider → 404 USER_PROVIDER_NOT_LINKED', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    unlinkProvider.mockRejectedValueOnce(new AppError('USER_PROVIDER_NOT_LINKED'));

    const res = await DELETE(delRequest(), ctx('github'));

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('USER_PROVIDER_NOT_LINKED');
  });

  it('미인증 → 401, unlinkProvider 미호출', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));

    const res = await DELETE(delRequest(), ctx('google'));

    expect(res.status).toBe(401);
    expect(unlinkProvider).not.toHaveBeenCalled();
  });
});
