import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { __resetRateLimitStateForTesting, POLICIES } from '@/lib/security/rate-limit';

// CANDID-020 Step 2 — POST /api/v1/auth/password/reset-request 라우트 통합 테스트.
// 핵심 보안 불변식(계정 열거 방지 균일 200)은 라우트 레벨에서만 관측 가능 → 서비스 단위 테스트로는
// 검증 불가. resend-verification.test.ts 패턴 미러링 (PII-safe 로깅 / fire-and-forget / rate-limit).

vi.mock('@/lib/auth/password-reset', () => ({
  requestPasswordReset: vi.fn(),
}));
vi.mock('@/lib/email/transport', () => ({
  sendMail: vi.fn(async () => undefined),
}));
// 메일 빌더는 env(NEXT_PUBLIC_APP_URL) 의존 → 라우트 동작 테스트에서는 고정 메시지로 mock.
vi.mock('@/lib/email/templates/reset-password', () => ({
  buildResetPasswordMessage: vi.fn(() => ({
    to: 'u@x.test',
    subject: 's',
    html: 'h',
    text: 't',
  })),
}));

const { requestPasswordReset } = (await import('@/lib/auth/password-reset')) as unknown as {
  requestPasswordReset: Mock;
};
const { sendMail } = (await import('@/lib/email/transport')) as unknown as { sendMail: Mock };
const { POST } = await import('@/app/api/v1/auth/password/reset-request/route');

beforeEach(() => {
  vi.stubEnv('TRUST_PROXY', 'true');
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
  vi.resetAllMocks();
  sendMail.mockImplementation(async () => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetRateLimitStateForTesting();
});

function postRequest(email: unknown = 'user@example.com', ip = '203.0.113.50'): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/password/reset-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email }),
  });
}

describe('POST /api/v1/auth/password/reset-request', () => {
  it('적격 — 200 균일 메시지 + 메일 1회 fire-and-forget + 평문 토큰 응답 미노출', async () => {
    requestPasswordReset.mockResolvedValueOnce({
      email: 'u@x.test',
      name: 'X',
      resetToken: 'a'.repeat(64),
    });

    const response = await POST(postRequest('u@x.test'), undefined);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('message');
    // 평문 토큰은 응답에 절대 노출 금지.
    expect(body).not.toHaveProperty('resetToken');
    expect(JSON.stringify(body)).not.toContain('a'.repeat(64));

    await new Promise((r) => setImmediate(r));
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('비적격(서비스 null) — 적격과 동일한 200 본문 + 메일 미발송 (계정 열거 방지 핵심)', async () => {
    // 적격 케이스 본문 캡처 (IP1).
    requestPasswordReset.mockResolvedValueOnce({
      email: 'u@x.test',
      name: 'X',
      resetToken: 'a'.repeat(64),
    });
    const eligible = await POST(postRequest('u@x.test', '203.0.113.51'), undefined);
    const eligibleBody = await eligible.json();

    // 비적격 케이스 (다른 IP로 rate-limit 회피).
    requestPasswordReset.mockResolvedValueOnce(null);
    const ineligible = await POST(postRequest('nobody@x.test', '203.0.113.52'), undefined);

    expect(ineligible.status).toBe(eligible.status); // 둘 다 200
    expect(await ineligible.json()).toEqual(eligibleBody); // 본문 바이트 동일
    // 메일은 적격 케이스에서만 1회. 비적격은 미발송.
    await new Promise((r) => setImmediate(r));
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('메일 발송 실패가 응답을 막지 않음(BR-TX-02) + 평문 email/token 미로깅 (사이드채널 가드)', async () => {
    requestPasswordReset.mockResolvedValueOnce({
      email: 'u@x.test',
      name: 'X',
      resetToken: 'b'.repeat(64),
    });
    // SMTP 응답 본문에 평문 이메일이 합성될 수 있음.
    sendMail.mockRejectedValueOnce(new Error('550 5.1.1 <u@x.test>: Recipient address rejected'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await POST(postRequest('u@x.test'), undefined);
      expect(response.status).toBe(200);
      await new Promise((r) => setImmediate(r));
      expect(errSpy).toHaveBeenCalled();
      // 평문 email / token이 로그 인자 어디에도 등장 금지.
      const logged = JSON.stringify(errSpy.mock.calls);
      expect(logged).not.toContain('u@x.test');
      expect(logged).not.toContain('b'.repeat(64));
      // 컨텍스트는 도메인만 노출 (emailDomain), 평문 email 키 없음.
      const ctxArg = errSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
      expect(ctxArg).toBeDefined();
      expect(ctxArg).not.toHaveProperty('email');
      expect(ctxArg).toHaveProperty('emailDomain', 'x.test');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('잘못된 이메일 형식 → 400 + requestPasswordReset 미호출 (열거와 무관한 입력 결함)', async () => {
    const response = await POST(postRequest('not-an-email'), undefined);
    expect(response.status).toBe(400);
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('Rate Limit (POLICIES.PASSWORD_RESET) — N+1번째 요청 429 + 정책 헤더', async () => {
    const limit = POLICIES.PASSWORD_RESET.maxRequests;
    requestPasswordReset.mockResolvedValue(null); // 비적격이어도 rate-limit은 동일 적용.

    for (let i = 0; i < limit; i++) {
      const ok = await POST(postRequest('user@example.com', '203.0.113.77'), undefined);
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(postRequest('user@example.com', '203.0.113.77'), undefined);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');
    expect(blocked.headers.get('X-RateLimit-Policy')).toBe(POLICIES.PASSWORD_RESET.name);
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
  });
});
