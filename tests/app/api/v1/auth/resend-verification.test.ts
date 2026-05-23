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

  it('메일 발송 실패가 응답을 막지 않음 (BR-TX-02) + H001/H002/H003 PII 회귀 가드', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    resendVerificationEmail.mockResolvedValueOnce({
      verificationToken: 'a'.repeat(64),
      nextResendAvailableAt: new Date('2026-05-23T12:01:00Z'),
    });
    prisma.user.findUnique.mockResolvedValueOnce({ email: 'u@x.test', name: 'X' });
    // nodemailer가 SMTP 응답 본문(평문 이메일 포함)을 err.message에 합성
    sendMail.mockRejectedValueOnce(new Error('550 5.1.1 <u@x.test>: Recipient address rejected'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(errSpy).toHaveBeenCalled();

    // 평문 email 로그 인자 어디에도 등장 금지
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('u@x.test');

    const ctxArg = errSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(ctxArg).toBeDefined();
    expect(ctxArg).not.toHaveProperty('email');
    expect(ctxArg).not.toHaveProperty('err');
    expect(ctxArg).toHaveProperty('emailDomain', 'x.test');
    expect(ctxArg).toHaveProperty('errName');
    expect(ctxArg).toMatchObject({ errMessage: expect.stringContaining('<email-redacted>') });

    errSpy.mockRestore();
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

  it('userId-bucket Rate Limit (USER_POLICIES.RESEND_VERIFICATION_USER 3회/시간) — 4번째 요청 429 (PR #33 H004)', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    resendVerificationEmail.mockResolvedValue({
      verificationToken: 'a'.repeat(64),
      nextResendAvailableAt: new Date(),
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'u@x.test', name: 'X' });

    // 다른 IP 사용 — IP-bucket (SIGNUP 5회/시간/IP) 회피, userId-bucket (3회/시간/user) 진입.
    for (let i = 0; i < 3; i++) {
      const r = await POST(postRequest(`10.0.0.${i + 1}`), undefined);
      expect(r.status).toBe(200);
    }
    const blocked = await POST(postRequest('10.0.0.99'), undefined);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');
    // 참고: 외부 withRateLimit(SIGNUP) wrapper가 inner withUserRateLimit의 429 응답 헤더를
    // 정상 통과(probe.limited=false) 정보로 덮어써 X-RateLimit-Policy가 'signup'으로 노출됨.
    // 표준 backoff 측면에서는 user-bucket 정책 정보가 더 유용 — 별도 task로 wrapper 동작 보강 검토.
  });

  it('user.findUnique null 분기 — 200 응답 + sendMail 미호출 (PR #34 H014 명시적 가드)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    resendVerificationEmail.mockResolvedValueOnce({
      verificationToken: 'a'.repeat(64),
      nextResendAvailableAt: new Date('2026-05-23T12:01:00Z'),
    });
    // user가 race condition으로 삭제된 직후
    prisma.user.findUnique.mockResolvedValueOnce(null);

    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
