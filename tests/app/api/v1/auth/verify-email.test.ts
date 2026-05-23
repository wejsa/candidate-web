import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';

vi.mock('@/lib/auth/email-verification', () => ({
  consumeVerificationToken: vi.fn(),
}));

const { consumeVerificationToken } = (await import('@/lib/auth/email-verification')) as unknown as {
  consumeVerificationToken: Mock;
};
const { POST } = await import('@/app/api/v1/auth/verify-email/route');

beforeEach(() => {
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_TOKEN = 'a'.repeat(64);

describe('POST /api/v1/auth/verify-email', () => {
  it('유효 토큰 → 200 + emailVerifiedAt + alreadyVerified=false', async () => {
    const verifiedAt = new Date('2026-05-23T12:00:00Z');
    consumeVerificationToken.mockResolvedValueOnce({
      userId: 42,
      emailVerifiedAt: verifiedAt,
      alreadyVerified: false,
    });
    const response = await POST(postRequest({ token: VALID_TOKEN }), undefined);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      emailVerifiedAt: verifiedAt.toISOString(),
      alreadyVerified: false,
    });
  });

  it('멱등 응답 — 이미 소진된 토큰 → 200 + alreadyVerified=true', async () => {
    const verifiedAt = new Date('2026-05-23T10:00:00Z');
    consumeVerificationToken.mockResolvedValueOnce({
      userId: 42,
      emailVerifiedAt: verifiedAt,
      alreadyVerified: true,
    });
    const response = await POST(postRequest({ token: VALID_TOKEN }), undefined);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadyVerified).toBe(true);
  });

  it('토큰 형식 오류 → 400 SYS_VALIDATION_FAILED (Zod)', async () => {
    const response = await POST(postRequest({ token: 'too-short' }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(consumeVerificationToken).not.toHaveBeenCalled();
  });

  it('토큰 부재(DB row 없음) → 400 AUTH_VERIFICATION_TOKEN_INVALID', async () => {
    consumeVerificationToken.mockRejectedValueOnce(new AppError('AUTH_VERIFICATION_TOKEN_INVALID'));
    const response = await POST(postRequest({ token: VALID_TOKEN }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'AUTH_VERIFICATION_TOKEN_INVALID',
      message: '유효하지 않은 이메일 인증 토큰입니다.',
      path: '/api/v1/auth/verify-email',
    });
  });

  it('만료 토큰 → 410 AUTH_VERIFICATION_TOKEN_EXPIRED', async () => {
    consumeVerificationToken.mockRejectedValueOnce(new AppError('AUTH_VERIFICATION_TOKEN_EXPIRED'));
    const response = await POST(postRequest({ token: VALID_TOKEN }), undefined);
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.code).toBe('AUTH_VERIFICATION_TOKEN_EXPIRED');
  });
});
