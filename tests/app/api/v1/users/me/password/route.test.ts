// CANDID-024 Step 3 — POST /api/v1/users/me/password 통합 테스트.
// requireAuth + changePassword를 mock하여 배선/검증/에러 변환/rate limit을 검증한다.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetRateLimitStateForTesting } from '@/lib/security/rate-limit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/users/password-change', () => ({ changePassword: vi.fn() }));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { changePassword } = (await import('@/lib/users/password-change')) as unknown as {
  changePassword: Mock;
};
const { POST } = await import('@/app/api/v1/users/me/password/route');

beforeEach(() => {
  __resetCachedEnvForTesting();
  __resetRateLimitStateForTesting();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetRateLimitStateForTesting();
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/users/me/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest-ua' },
    body: JSON.stringify(body),
  });
}

const validBody = { currentPassword: 'OldPass123!', newPassword: 'NewPass456!' };

describe('POST /api/v1/users/me/password', () => {
  it('204 + changePassword 호출 인자 전파 (평문 비번 응답 없음)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    changePassword.mockResolvedValueOnce({ mode: 'changed', revokedSessionCount: 2 });

    const res = await POST(postRequest(validBody), undefined);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(changePassword).toHaveBeenCalledWith({
      userId: 42,
      currentPassword: 'OldPass123!',
      newPassword: 'NewPass456!',
      userAgent: 'vitest-ua',
      ipAddress: null,
    });
  });

  it('약한 새 비밀번호(강도 미달) → 400 SYS_VALIDATION_FAILED', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });

    const res = await POST(postRequest({ newPassword: 'short' }), undefined);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('SYS_VALIDATION_FAILED');
    expect(changePassword).not.toHaveBeenCalled();
  });

  // 리뷰 MAJOR(test): 검증 실패 에러 응답 body에 평문 비밀번호가 새지 않아야 한다 (BR-PII-02 경계 가드).
  it('400 에러 응답 body에 평문 비밀번호 미포함', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });

    const res = await POST(
      postRequest({ currentPassword: 'OldPass123!', newPassword: 'weak' }),
      undefined,
    );
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(text).not.toContain('OldPass123!');
    expect(text).not.toContain('weak');
  });

  it('새 비번 = 현재 비번 → 400 (refine)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });

    const res = await POST(
      postRequest({ currentPassword: 'SamePass123!', newPassword: 'SamePass123!' }),
      undefined,
    );

    expect(res.status).toBe(400);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('현재 비번 불일치 → 401 AUTH_INVALID_CREDENTIALS', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    changePassword.mockRejectedValueOnce(new AppError('AUTH_INVALID_CREDENTIALS'));

    const res = await POST(postRequest(validBody), undefined);

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  // QA M3: 비번 보유자가 currentPassword 누락 → changePassword가 RECONFIRM(422) throw → 422 변환.
  it('현재 비번 재확인 필요 → 422 USER_PASSWORD_RECONFIRM_REQUIRED', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    changePassword.mockRejectedValueOnce(new AppError('USER_PASSWORD_RECONFIRM_REQUIRED'));

    const res = await POST(postRequest({ newPassword: 'NewPass456!' }), undefined);

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('USER_PASSWORD_RECONFIRM_REQUIRED');
  });

  it('미인증 → 401, changePassword 미호출', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));

    const res = await POST(postRequest(validBody), undefined);

    expect(res.status).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rate limit 초과(5/시간) → 429 SYS_RATE_LIMITED', async () => {
    requireAuth.mockResolvedValue({ userId: 9 });
    changePassword.mockResolvedValue({ mode: 'changed', revokedSessionCount: 1 });

    for (let i = 0; i < 5; i++) {
      const ok = await POST(postRequest(validBody), undefined);
      expect(ok.status).toBe(204);
    }
    const limited = await POST(postRequest(validBody), undefined);
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe('SYS_RATE_LIMITED');
  });
});
