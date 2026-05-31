// CANDID-024 Step 1 — GET /api/v1/users/me 통합 테스트.
// requireAuth + getProfile를 mock하여 라우터 배선/에러 변환/PII 비노출을 검증한다.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/users/profile-service', () => ({ getProfile: vi.fn() }));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { getProfile } = (await import('@/lib/users/profile-service')) as unknown as {
  getProfile: Mock;
};
const { GET } = await import('@/app/api/v1/users/me/route');

beforeEach(() => {
  __resetCachedEnvForTesting();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function getRequest(): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/users/me', {
    method: 'GET',
    headers: { 'user-agent': 'vitest-ua' },
  });
}

const profile = {
  name: '김지원',
  email: 'kim@example.com',
  phoneMasked: '010-****-5678',
  hasPassword: true,
  providers: [{ provider: 'google', linkedAt: '2026-01-02T03:04:05.000Z' }],
};

describe('GET /api/v1/users/me', () => {
  it('200 + 프로필 DTO 반환 + getProfile(userId) 호출', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    getProfile.mockResolvedValueOnce(profile);

    const res = await GET(getRequest(), undefined);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(profile);
    expect(getProfile).toHaveBeenCalledWith(42);
  });

  it('미인증 → requireAuth가 throw한 AppError가 표준 401로 변환', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));

    const res = await GET(getRequest(), undefined);

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('AUTH_TOKEN_INVALID');
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('응답 body에 평문 phone 키/passwordHash가 없다 (회귀 가드)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    getProfile.mockResolvedValueOnce(profile);

    const res = await GET(getRequest(), undefined);
    const text = await res.text();

    expect(text).not.toContain('passwordHash');
    // phoneMasked만 존재해야 하며 평문 "phone" 키는 없어야 한다.
    expect(text).not.toMatch(/"phone"\s*:/);
  });

  it('USER_NOT_FOUND(탈퇴/삭제) → 404', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 99 });
    getProfile.mockRejectedValueOnce(new AppError('USER_NOT_FOUND'));

    const res = await GET(getRequest(), undefined);

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('USER_NOT_FOUND');
  });
});
