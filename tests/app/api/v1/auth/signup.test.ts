import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { __resetRateLimitStateForTesting } from '@/lib/security/rate-limit';

// signup.ts / email transport는 mock — Route Handler의 status/Cookie/응답 본문/rate-limit 통합만 검증.
vi.mock('@/lib/auth/signup', () => ({
  createUserAndIssueTokens: vi.fn(),
}));
vi.mock('@/lib/email/transport', () => ({
  sendMail: vi.fn(async () => undefined),
}));

const { createUserAndIssueTokens } = (await import('@/lib/auth/signup')) as unknown as {
  createUserAndIssueTokens: Mock;
};
const { sendMail } = (await import('@/lib/email/transport')) as unknown as { sendMail: Mock };
const { POST } = await import('@/app/api/v1/auth/signup/route');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
  vi.stubEnv('TRUST_PROXY', 'true');
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
});

const validBody = {
  email: 'newuser@example.com',
  password: 'CorrectHorse!23',
  passwordConfirm: 'CorrectHorse!23',
  name: '홍길동',
  termsAgreed: true,
  privacyAgreed: true,
  ageConfirmed: true,
  marketingAgreed: false,
};

function postRequest(body: unknown, ip = '203.0.113.10'): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/signup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'user-agent': 'vitest',
    },
    body: JSON.stringify(body),
  });
}

const successResult = {
  user: { id: 42, email: 'newuser@example.com', name: '홍길동', emailVerifiedAt: null },
  tokens: {
    accessToken: 'access-jwt-fake',
    accessExpiresAt: new Date('2026-06-01T00:00:00Z'),
    refreshToken: 'refresh-jwt-fake',
    refreshExpiresAt: new Date('2026-06-15T00:00:00Z'),
  },
  verificationToken: 'a'.repeat(64),
};

describe('POST /api/v1/auth/signup — 정상', () => {
  it('201 + user 응답 + Set-Cookie 2종(access/refresh)', async () => {
    createUserAndIssueTokens.mockResolvedValueOnce(successResult);
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      user: { id: 42, email: 'newuser@example.com', name: '홍길동', emailVerifiedAt: null },
      verificationEmailQueued: true,
    });

    // Step 3 fix(Step 2 review Test MAJOR-1): 평문 verificationToken은 응답에 절대 노출 금지.
    expect(body).not.toHaveProperty('verificationToken');
    expect(JSON.stringify(body)).not.toContain(successResult.verificationToken);

    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('access_token=access-jwt-fake'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('refresh_token=refresh-jwt-fake'))).toBe(true);

    // Step 3 fix(Step 2 review Test MAJOR-2): Cookie 보안 속성 명시 검증.
    const accessCookie = setCookies.find((c) => c.startsWith('access_token='));
    expect(accessCookie).toContain('HttpOnly');
    expect(accessCookie).toContain('SameSite=lax');
    expect(accessCookie).toContain('Path=/');
    const refreshCookie = setCookies.find((c) => c.startsWith('refresh_token='));
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=lax');
  });

  it('X-RateLimit-* 헤더 부착 (CANDID-009 첫 실 부착)', async () => {
    createUserAndIssueTokens.mockResolvedValueOnce(successResult);
    const response = await POST(postRequest(validBody), undefined);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('5'); // POLICIES.SIGNUP
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('4');
    expect(response.headers.get('X-RateLimit-Policy')).toBe('signup');
  });

  it('인증 메일 fire-and-forget — sendMail 호출되지만 응답을 막지 않음', async () => {
    createUserAndIssueTokens.mockResolvedValueOnce(successResult);
    sendMail.mockImplementation(async () => undefined);
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(201);
    // sendMail은 비동기로 호출됨 (await 없음)
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailMsg = sendMail.mock.calls[0]?.[0] as { to: string; subject: string };
    expect(mailMsg.to).toBe('newuser@example.com');
    expect(mailMsg.subject).toContain('이메일 인증');
  });

  it('메일 발송 실패가 가입을 막지 않음 (BR-TX-02) + H001/H003 PII 회귀 가드', async () => {
    createUserAndIssueTokens.mockResolvedValueOnce(successResult);
    // nodemailer가 SMTP 응답 본문(평문 이메일 포함)을 err.message에 합성하는 실제 시나리오 재현
    sendMail.mockRejectedValueOnce(
      new Error('550 5.1.1 <newuser@example.com>: Recipient address rejected'),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(201);
    await new Promise((r) => setImmediate(r));
    expect(errSpy).toHaveBeenCalled();

    // H003 회귀 가드: 평문 email/비밀번호가 로그 인자 어디에도 등장 금지
    const serialized = JSON.stringify(errSpy.mock.calls);
    expect(serialized).not.toContain('newuser@example.com');
    expect(serialized).not.toContain('CorrectHorse!23');

    // H001 회귀 가드: errMessage가 SMTP 응답 본문의 이메일을 redact했어야 함
    const ctxArg = errSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(ctxArg).toBeDefined();
    expect(ctxArg).not.toHaveProperty('email');
    expect(ctxArg).not.toHaveProperty('err'); // err 객체째 펼침 금지
    expect(ctxArg).toHaveProperty('emailDomain', 'example.com');
    expect(ctxArg).toHaveProperty('errName');
    expect(ctxArg).toMatchObject({ errMessage: expect.stringContaining('<email-redacted>') });

    errSpy.mockRestore();
  });

  it('smtpResponseCode truthy 분기 — SMTPError-like err에서 추출 (PR #34 M004)', async () => {
    createUserAndIssueTokens.mockResolvedValueOnce(successResult);
    // nodemailer SMTPError 형태 — responseCode 부여
    const smtpErr = Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 });
    sendMail.mockRejectedValueOnce(smtpErr);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await POST(postRequest(validBody), undefined);
      await new Promise((r) => setImmediate(r));
      const ctxArg = errSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
      expect(ctxArg).toBeDefined();
      expect(ctxArg).toHaveProperty('smtpResponseCode', 550);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('비-Error throw fallback — <non-error-throw> 일괄 대체 (PR #34 M005)', async () => {
    createUserAndIssueTokens.mockResolvedValueOnce(successResult);
    // toString override로 PII 우회 시도하는 비표준 throw
    const nasty = {
      envelope: { to: 'attacker@example.com' },
      toString() {
        return `Mail to ${this.envelope.to} rejected`;
      },
    };
    sendMail.mockRejectedValueOnce(nasty as unknown as Error);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await POST(postRequest(validBody), undefined);
      await new Promise((r) => setImmediate(r));
      expect(JSON.stringify(errSpy.mock.calls)).not.toContain('attacker@example.com');
      const ctxArg = errSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
      expect(ctxArg).toMatchObject({
        errName: 'Unknown',
        errMessage: '<non-error-throw>',
      });
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('POST /api/v1/auth/signup — 검증 실패', () => {
  it('이메일 형식 오류 → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await POST(postRequest({ ...validBody, email: 'not-email' }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
  });

  it('약관 미동의 → 400 + 표준 응답 7필드', async () => {
    const response = await POST(postRequest({ ...validBody, termsAgreed: false }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'SYS_VALIDATION_FAILED',
      status: 400,
      path: '/api/v1/auth/signup',
    });
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('IDN homograph 이메일 → 400 (Step 2 fix H002)', async () => {
    // 키릴 'а'(U+0430) 사칭 도메인 — `gmail.com` vs `gmаil.com`
    const response = await POST(postRequest({ ...validBody, email: 'admin@gmаіl.com' }), undefined);
    expect(response.status).toBe(400);
    expect(createUserAndIssueTokens).not.toHaveBeenCalled();
  });

  it('punycode(xn--) 도메인도 거부', async () => {
    const response = await POST(
      postRequest({ ...validBody, email: 'a@xn--rg-via.example' }),
      undefined,
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/auth/signup — 비즈니스 에러', () => {
  it('중복 이메일 — AppError USER_EMAIL_DUPLICATED → 409 + 표준 7필드 + 메시지 검증', async () => {
    createUserAndIssueTokens.mockRejectedValueOnce(new AppError('USER_EMAIL_DUPLICATED'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(409);
    const body = await response.json();
    // Step 3 fix(Step 2 review Test MAJOR-4): code + 사용자 가시 메시지(US-AUTH-001 수락기준) 회귀 가드.
    expect(body).toMatchObject({
      code: 'USER_EMAIL_DUPLICATED',
      status: 409,
      message: '이미 가입된 이메일입니다.',
      path: '/api/v1/auth/signup',
    });
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('POST /api/v1/auth/signup — Rate Limit (BR-SEC-04 5회/시간/IP)', () => {
  it('6번째 요청은 429 SYS_RATE_LIMITED + Retry-After', async () => {
    createUserAndIssueTokens.mockResolvedValue(successResult);
    const r = postRequest(validBody, '203.0.113.99');
    // 5회 소진
    for (let i = 0; i < 5; i++) await POST(postRequest(validBody, '203.0.113.99'), undefined);
    const blocked = await POST(r, undefined);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
    expect(blocked.headers.get('X-RateLimit-Policy')).toBe('signup');
  });
});
