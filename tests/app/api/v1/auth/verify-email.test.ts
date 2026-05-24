import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { POLICIES, __resetRateLimitStateForTesting } from '@/lib/security/rate-limit';

vi.mock('@/lib/auth/email-verification', () => ({
  consumeVerificationToken: vi.fn(),
}));

const { consumeVerificationToken } = (await import('@/lib/auth/email-verification')) as unknown as {
  consumeVerificationToken: Mock;
};
const { POST } = await import('@/app/api/v1/auth/verify-email/route');

beforeEach(() => {
  // CANDID-036: VERIFY_EMAIL RL 부착됨 — TRUST_PROXY 활성화 + bucket 격리.
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

function postRequest(body: unknown, ip = '203.0.113.10'): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
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

  it('에러 응답 표준 7필드 회귀 가드 (PR #33 H014 — verify-email/resend 비대칭 해소)', async () => {
    consumeVerificationToken.mockRejectedValueOnce(new AppError('AUTH_VERIFICATION_TOKEN_INVALID'));
    const response = await POST(postRequest({ token: VALID_TOKEN }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'AUTH_VERIFICATION_TOKEN_INVALID',
      status: 400,
      message: '유효하지 않은 이메일 인증 토큰입니다.',
      path: '/api/v1/auth/verify-email',
    });
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('POST /api/v1/auth/verify-email — CANDID-036 Rate Limit (PR #33 H005)', () => {
  // CANDID-037 H005: 매직 넘버 제거 — POLICIES.VERIFY_EMAIL.maxRequests를 import해 정책 자동 추종.
  it('N+1회 한도 초과 시 429 + X-RateLimit-* 헤더', async () => {
    const limit = POLICIES.VERIFY_EMAIL.maxRequests;
    consumeVerificationToken.mockResolvedValue({
      userId: 42,
      emailVerifiedAt: new Date(),
      alreadyVerified: false,
    });

    // 한도까지 통과
    for (let i = 0; i < limit; i++) {
      const r = await POST(postRequest({ token: VALID_TOKEN }), undefined);
      expect(r.status).toBe(200);
    }

    // 한도+1번째 → 429
    const blocked = await POST(postRequest({ token: VALID_TOKEN }), undefined);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Policy')).toBe(POLICIES.VERIFY_EMAIL.name);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe(String(limit));
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
    const body = await blocked.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');
  });

  it('다른 IP는 격리된 카운터 (NAT 환경 다수 사용자 보호)', async () => {
    const limit = POLICIES.VERIFY_EMAIL.maxRequests;
    consumeVerificationToken.mockResolvedValue({
      userId: 42,
      emailVerifiedAt: new Date(),
      alreadyVerified: false,
    });
    // IP A: 한도 소진
    for (let i = 0; i < limit; i++)
      await POST(postRequest({ token: VALID_TOKEN }, '1.1.1.1'), undefined);
    const blockedA = await POST(postRequest({ token: VALID_TOKEN }, '1.1.1.1'), undefined);
    expect(blockedA.status).toBe(429);
    // IP B: 영향 없음
    const okB = await POST(postRequest({ token: VALID_TOKEN }, '2.2.2.2'), undefined);
    expect(okB.status).toBe(200);
  });
});
