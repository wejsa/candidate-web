import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import {
  __resetRateLimitStateForTesting,
  POLICIES,
  USER_POLICIES,
} from '@/lib/security/rate-limit';

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
  // CANDID-037: resetAllMocks → mockImplementationOnce 큐 누수 방지.
  // 단, resetAllMocks가 vi.mock factory의 기본 impl도 초기화하므로 호출 사이드 이펙트가 있는
  // mock(sendMail = Promise 반환)은 default impl을 재설정한다.
  vi.resetAllMocks();
  sendMail.mockImplementation(async () => undefined);
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
  it('정상 — 200 + nextResendAvailableAt + 메일 fire-and-forget + user-bucket 헤더', async () => {
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

    // CANDID-037 L-023: inner(user-bucket) 정책명이 외부 SIGNUP보다 우선 노출되어야 한다.
    expect(response.headers.get('X-RateLimit-Policy')).toBe(
      USER_POLICIES.RESEND_VERIFICATION_USER.name,
    );
    expect(response.headers.get('X-RateLimit-Limit')).toBe(
      String(USER_POLICIES.RESEND_VERIFICATION_USER.maxRequests),
    );
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

    try {
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
    } finally {
      // CANDID-037 H012: errSpy 정리를 try/finally로 보장 — 예외 시 다른 케이스 spy 누수 방지.
      errSpy.mockRestore();
    }
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

  // CANDID-037 Step 3 — Step 2에서 추가된 진입 가드의 라우터 통합 검증
  it('이미 인증된 사용자 → 409 AUTH_EMAIL_ALREADY_VERIFIED (CANDID-037 D3)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    resendVerificationEmail.mockRejectedValueOnce(new AppError('AUTH_EMAIL_ALREADY_VERIFIED'));

    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'AUTH_EMAIL_ALREADY_VERIFIED',
      message: '이미 인증된 이메일입니다. 재발송이 필요하지 않습니다.',
      path: '/api/v1/auth/resend-verification',
    });
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('사용자 race deletion → 404 USER_NOT_FOUND (CANDID-037)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    resendVerificationEmail.mockRejectedValueOnce(new AppError('USER_NOT_FOUND'));

    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('USER_NOT_FOUND');
    expect(sendMail).not.toHaveBeenCalled();
  });

  // CANDID-037 H005: 매직 넘버 제거 + IP-bucket 단독 검증 (user-bucket 회피 위해 매번 다른 userId)
  it('IP Rate Limit (POLICIES.SIGNUP) — N+1번째 요청 429 + 정책 헤더', async () => {
    const limit = POLICIES.SIGNUP.maxRequests;
    // 매번 다른 userId — user-bucket(3회/시간/user) 회피하여 IP-bucket(SIGNUP) 단독 검증.
    let userSeq = 1000;
    requireAuth.mockImplementation(async () => ({ userId: userSeq++ }));
    resendVerificationEmail.mockResolvedValue({
      verificationToken: 'a'.repeat(64),
      nextResendAvailableAt: new Date(),
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'u@x.test', name: 'X' });

    for (let i = 0; i < limit; i++) {
      const ok = await POST(postRequest('203.0.113.77'), undefined);
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(postRequest('203.0.113.77'), undefined);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');
    // IP 한도 초과 시점에는 user-bucket이 발동하지 않으므로 SIGNUP 정책명 노출.
    expect(blocked.headers.get('X-RateLimit-Policy')).toBe('signup');
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
  });

  // CANDID-037: 매직 넘버 제거 + 호출 도달 검증 강화 (H004/H007/H008)
  it('userId-bucket Rate Limit (USER_POLICIES.RESEND_VERIFICATION_USER) — N+1번째 429 + inner 헤더 우선', async () => {
    const userLimit = USER_POLICIES.RESEND_VERIFICATION_USER.maxRequests;
    requireAuth.mockResolvedValue({ userId: 42 });
    resendVerificationEmail.mockResolvedValue({
      verificationToken: 'a'.repeat(64),
      nextResendAvailableAt: new Date(),
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'u@x.test', name: 'X' });

    // 다른 IP 사용 — IP-bucket (SIGNUP) 회피, userId-bucket (3회/시간/user) 진입.
    for (let i = 0; i < userLimit; i++) {
      const r = await POST(postRequest(`10.0.0.${i + 1}`), undefined);
      expect(r.status).toBe(200);
      // 정상 path에서 inner 헤더 우선 (L-023).
      expect(r.headers.get('X-RateLimit-Policy')).toBe(
        USER_POLICIES.RESEND_VERIFICATION_USER.name,
      );
    }

    const blocked = await POST(postRequest('10.0.0.99'), undefined);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');

    // CANDID-037 H004: 호출 도달 검증 — userLimit 회 통과 + 1회 차단 = 비즈니스 호출 userLimit 회.
    expect(resendVerificationEmail).toHaveBeenCalledTimes(userLimit);

    // CANDID-037 H007/H008: limited 응답 헤더 검증 — inner user-bucket 정책명 + Remaining='0' + Retry-After.
    expect(blocked.headers.get('X-RateLimit-Policy')).toBe(
      USER_POLICIES.RESEND_VERIFICATION_USER.name,
    );
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe(String(userLimit));
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
  });

  // CANDID-037 H008 명시: user.findUnique null 분기에서도 정상 200 + nextResendAvailableAt ISO 검증
  it('user.findUnique null 분기 — 200 응답 + sendMail 미호출 + nextResendAvailableAt ISO (H008)', async () => {
    const nextAt = new Date('2026-05-23T12:01:00Z');
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    resendVerificationEmail.mockResolvedValueOnce({
      verificationToken: 'a'.repeat(64),
      nextResendAvailableAt: nextAt,
    });
    // resendVerificationEmail은 성공했으나 라우터의 user.findUnique가 race deletion으로 null.
    prisma.user.findUnique.mockResolvedValueOnce(null);

    const response = await POST(postRequest(), undefined);
    expect(response.status).toBe(200);
    const body = await response.json();
    // CANDID-037 H008: 명시적 nextResendAvailableAt ISO 검증
    expect(body).toEqual({ nextResendAvailableAt: nextAt.toISOString() });
    expect(sendMail).not.toHaveBeenCalled();
    // 정상 path이므로 user-bucket 헤더 부착됨.
    expect(response.headers.get('X-RateLimit-Policy')).toBe(
      USER_POLICIES.RESEND_VERIFICATION_USER.name,
    );
  });
});
