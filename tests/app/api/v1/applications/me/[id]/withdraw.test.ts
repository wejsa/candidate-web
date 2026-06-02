// CANDID-023 Step 3 — POST /api/v1/applications/me/[id]/withdraw 라우터 통합 테스트.

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/applications/withdraw', () => ({
  withdrawApplication: vi.fn(),
}));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { withdrawApplication } = (await import('@/lib/applications/withdraw')) as unknown as {
  withdrawApplication: Mock;
};
const { POST } = await import('@/app/api/v1/applications/me/[id]/withdraw/route');

const RESULT = { result: 'WITHDRAWN', withdrawnAt: '2026-06-02T12:00:00.000Z' };

function postRequest(body?: unknown): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/applications/me/100/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ userId: 42 });
  withdrawApplication.mockResolvedValue(RESULT);
});

describe('POST /api/v1/applications/me/[id]/withdraw', () => {
  it('200 + 사유와 함께 철회한다 (userAgent 주입, ipAddress=null)', async () => {
    const response = await POST(postRequest({ reason: '개인 사정' }), ctx('100'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESULT);
    expect(withdrawApplication).toHaveBeenCalledWith({
      userId: 42,
      applicationId: 100,
      reason: '개인 사정',
      userAgent: 'Mozilla/5.0',
      ipAddress: null,
    });
  });

  it('200 + 빈 body 철회 (사유 미입력 → reason=null)', async () => {
    const response = await POST(postRequest(), ctx('100'));

    expect(response.status).toBe(200);
    expect(withdrawApplication).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, applicationId: 100, reason: null }),
    );
  });

  it('서비스가 APP_NOT_WITHDRAWABLE → 409 표준 에러 응답', async () => {
    withdrawApplication.mockRejectedValue(new AppError('APP_NOT_WITHDRAWABLE'));

    const response = await POST(postRequest({ reason: 'x' }), ctx('100'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('APP_NOT_WITHDRAWABLE');
  });

  it('applicationId가 정수가 아니면 400 SYS_VALIDATION_FAILED', async () => {
    const response = await POST(postRequest({ reason: 'x' }), ctx('abc'));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('SYS_VALIDATION_FAILED');
    expect(withdrawApplication).not.toHaveBeenCalled();
  });

  it('reason 500자 초과 → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await POST(postRequest({ reason: 'a'.repeat(501) }), ctx('100'));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('SYS_VALIDATION_FAILED');
    expect(withdrawApplication).not.toHaveBeenCalled();
  });

  it('여분 키가 있으면 400 (.strict)', async () => {
    const response = await POST(postRequest({ reason: 'x', evil: 1 }), ctx('100'));

    expect(response.status).toBe(400);
    expect(withdrawApplication).not.toHaveBeenCalled();
  });
});
