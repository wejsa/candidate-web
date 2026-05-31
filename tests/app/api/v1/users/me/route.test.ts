// CANDID-024 Step 1+2 — GET/PATCH /api/v1/users/me 통합 테스트.
// requireAuth + getProfile/updateProfile를 mock하여 라우터 배선/에러 변환/PII 비노출/rate limit을 검증한다.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetRateLimitStateForTesting } from '@/lib/security/rate-limit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/users/profile-service', () => ({ getProfile: vi.fn(), updateProfile: vi.fn() }));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { getProfile, updateProfile } = (await import('@/lib/users/profile-service')) as unknown as {
  getProfile: Mock;
  updateProfile: Mock;
};
const { GET, PATCH } = await import('@/app/api/v1/users/me/route');

beforeEach(() => {
  __resetCachedEnvForTesting();
  __resetRateLimitStateForTesting();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetRateLimitStateForTesting();
});

function getRequest(): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/users/me', {
    method: 'GET',
    headers: { 'user-agent': 'vitest-ua' },
  });
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/users/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest-ua' },
    body: JSON.stringify(body),
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

  // 리뷰 MAJOR(test): requireAuth는 만료 시 AUTH_TOKEN_EXPIRED를 throw(middleware.ts) —
  // 클라이언트가 이 코드로 /auth/refresh를 분기하므로 401 매핑 회귀를 별도 가드한다.
  it('만료 토큰 → AUTH_TOKEN_EXPIRED가 표준 401로 변환 (refresh 트리거)', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_EXPIRED'));

    const res = await GET(getRequest(), undefined);

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('AUTH_TOKEN_EXPIRED');
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

  // 리뷰 MINOR(test): phoneMasked=null/providers=[] 변형 — null 필드가 키째 누락되지 않고
  // 직렬화에 보존되는지 가드 (UI의 `phoneMasked ?? '미등록'` 분기 회귀 방지).
  it('phoneMasked=null이어도 키가 보존되어 직렬화된다', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    getProfile.mockResolvedValueOnce({ ...profile, phoneMasked: null, providers: [] });

    const res = await GET(getRequest(), undefined);
    const body = (await res.json()) as { phoneMasked: unknown; providers: unknown[] };

    expect(body.phoneMasked).toBeNull();
    expect('phoneMasked' in body).toBe(true);
    expect(body.providers).toEqual([]);
  });

  it('USER_NOT_FOUND(탈퇴/삭제) → 404', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 99 });
    getProfile.mockRejectedValueOnce(new AppError('USER_NOT_FOUND'));

    const res = await GET(getRequest(), undefined);

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('USER_NOT_FOUND');
  });

  // QA P3 (IDOR 가드): 쿼리스트링의 임의 userId를 무시하고 토큰 userId로만 조회한다.
  it('쿼리스트링 userId를 무시하고 requireAuth가 반환한 userId로만 조회', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    getProfile.mockResolvedValueOnce(profile);

    const req = new NextRequest('https://candidate.example.com/api/v1/users/me?userId=1', {
      method: 'GET',
      headers: { 'user-agent': 'vitest-ua' },
    });
    const res = await GET(req, undefined);

    expect(res.status).toBe(200);
    expect(getProfile).toHaveBeenCalledWith(42);
    expect(getProfile).not.toHaveBeenCalledWith(1);
  });
});

describe('PATCH /api/v1/users/me', () => {
  it('200 + 갱신 DTO 반환 + updateProfile(userId, body) 호출 + RateLimit 헤더', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    updateProfile.mockResolvedValueOnce({ ...profile, name: '새이름' });

    const res = await PATCH(patchRequest({ name: '새이름' }), undefined);

    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('새이름');
    expect(updateProfile).toHaveBeenCalledWith(42, { name: '새이름' });
    // 리뷰 MAJOR(test): 헤더 존재만이 아니라 첫 호출 remaining 값(20-1=19)까지 단언.
    expect(res.headers.get('x-ratelimit-remaining')).toBe('19');
  });

  // 리뷰 MAJOR(test): phone=null(연락처 삭제)이 zod strict+refine을 통과해 그대로 updateProfile에 전달.
  it('phone=null(삭제) → 200 + updateProfile에 {phone:null} 전달', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    updateProfile.mockResolvedValueOnce({ ...profile, phoneMasked: null });

    const res = await PATCH(patchRequest({ phone: null }), undefined);

    expect(res.status).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith(42, { phone: null });
  });

  // 리뷰 MINOR(test): 미인증 PATCH 경로 — requireAuth throw → 401, updateProfile 미호출.
  it('미인증 → 401, updateProfile 미호출', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));

    const res = await PATCH(patchRequest({ name: '새' }), undefined);

    expect(res.status).toBe(401);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('빈 객체(변경 없음) → 400 SYS_VALIDATION_FAILED (zod refine)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });

    const res = await PATCH(patchRequest({}), undefined);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('SYS_VALIDATION_FAILED');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('잘못된 연락처 → 400', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });

    const res = await PATCH(patchRequest({ phone: '123' }), undefined);

    expect(res.status).toBe(400);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('updateProfile USER_NOT_FOUND(탈퇴) → 404', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    updateProfile.mockRejectedValueOnce(new AppError('USER_NOT_FOUND'));

    const res = await PATCH(patchRequest({ name: '새' }), undefined);

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('USER_NOT_FOUND');
  });

  it('user-bucket rate limit 초과(20/시간) → 429', async () => {
    requireAuth.mockResolvedValue({ userId: 7 });
    updateProfile.mockResolvedValue({ ...profile });

    // 20회는 통과, 21회째 차단.
    for (let i = 0; i < 20; i++) {
      const ok = await PATCH(patchRequest({ name: `n${i}` }), undefined);
      expect(ok.status).toBe(200);
    }
    const limited = await PATCH(patchRequest({ name: 'over' }), undefined);
    expect(limited.status).toBe(429);
    // 리뷰 MINOR(test): 429 code + Retry-After 헤더까지 단언 (다른 에러 케이스와 일관).
    expect((await limited.json()).code).toBe('SYS_RATE_LIMITED');
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });
});
