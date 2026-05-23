import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { __resetRateLimitStateForTesting } from '@/lib/security/rate-limit';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/auth/email-verification', () => ({
  resendVerificationEmail: vi.fn(),
}));
vi.mock('@/lib/email/transport', () => ({
  sendMail: vi.fn(async () => undefined),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { resendVerificationEmail } = (await import('@/lib/auth/email-verification')) as unknown as {
  resendVerificationEmail: Mock;
};
const { sendMail } = (await import('@/lib/email/transport')) as unknown as { sendMail: Mock };
const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { user: { findUnique: Mock } };
};
const { POST } = await import('@/app/api/v1/auth/resend-verification/route');

beforeEach(() => {
  vi.stubEnv('TRUST_PROXY', 'true');
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetRateLimitStateForTesting();
});

function postRequest(ip = '203.0.113.50'): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/resend-verification', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
  });
}

describe('POST /api/v1/auth/resend-verification', () => {
  it('정상 — 200 + nextResendAvailableAt + 메일 fire-and-forget', async () => {
    const nextAt = new Date('2026-05-23T12:01:00Z');
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    resendVerificationEmail.mockResolvedValueOnce({
      verificationToken: 'a'.repeat(64),
      nextResendAvailableAt: nextAt,
    });
    prisma.user.findUnique.mockResolvedValueOnce({ email: 'u@x.test', name: 'X' });

    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ nextResendAvailableAt: nextAt.toISOString() });

    // 평문 토큰은 응답에 노출 금지
    expect(body).not.toHaveProperty('verificationToken');

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailMsg = sendMail.mock.calls[0]?.[0] as { to: string };
    expect(mailMsg.to).toBe('u@x.test');
  });

  it('인증 실패 — requireAuth가 AUTH_TOKEN_INVALID throw → 401', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe('AUTH_TOKEN_INVALID');
    expect(resendVerificationEmail).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('60s 쿨다운 위반 → 429 AUTH_VERIFICATION_RESEND_COOLDOWN', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    resendVerificationEmail.mockRejectedValueOnce(
      new AppError('AUTH_VERIFICATION_RESEND_COOLDOWN'),
    );
    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'AUTH_VERIFICATION_RESEND_COOLDOWN',
      message: '재발송 요청이 너무 빠릅니다. 60초 후 다시 시도해 주세요.',
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('Rate Limit (POLICIES.SIGNUP 5회/시간/IP) — 6번째 요청 429', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    resendVerificationEmail.mockResolvedValue({
      verificationToken: 'a'.repeat(64),
      nextResendAvailableAt: new Date(),
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'u@x.test', name: 'X' });

    for (let i = 0; i < 5; i++) await POST(postRequest('203.0.113.77'), undefined);
    const blocked = await POST(postRequest('203.0.113.77'), undefined);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');
    expect(blocked.headers.get('X-RateLimit-Policy')).toBe('signup');
  });

  // user.findUnique null 케이스는 defensive 분기 — 정상 인증 통과 후엔 user가 존재 → 본 테스트 트리밍.
});
