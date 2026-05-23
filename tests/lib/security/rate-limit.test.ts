import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  __resetRateLimitStateForTesting,
  POLICIES,
  checkRateLimit,
  rateLimitKeyByIp,
  withRateLimit,
} from '@/lib/security/rate-limit';

beforeEach(() => {
  __resetRateLimitStateForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetRateLimitStateForTesting();
});

function req(headers: Record<string, string> = {}, method = 'POST'): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/login', { method, headers });
}

describe('rateLimitKeyByIp', () => {
  it('X-Forwarded-For 첫 번째 IP 우선', () => {
    expect(rateLimitKeyByIp(req({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }))).toBe(
      'ip:203.0.113.10',
    );
  });

  it('X-Forwarded-For 부재 시 X-Real-IP 폴백', () => {
    expect(rateLimitKeyByIp(req({ 'x-real-ip': '198.51.100.5' }))).toBe('ip:198.51.100.5');
  });

  it('헤더 모두 부재 시 unknown 키 반환', () => {
    expect(rateLimitKeyByIp(req())).toBe('ip:unknown');
  });

  it('X-Forwarded-For 공백 항목은 무시', () => {
    expect(rateLimitKeyByIp(req({ 'x-forwarded-for': '  ' }))).toBe('ip:unknown');
  });
});

describe('checkRateLimit — sliding window', () => {
  const POLICY = POLICIES.LOGIN; // 10/min/IP
  const r = req({ 'x-forwarded-for': '203.0.113.1' });

  it('한도 미만 요청은 not limited + remaining 감소', () => {
    const p1 = checkRateLimit(POLICY, r, 0);
    expect(p1).toMatchObject({ count: 1, remaining: 9, limited: false, retryAfterMs: 0 });
    const p2 = checkRateLimit(POLICY, r, 100);
    expect(p2).toMatchObject({ count: 2, remaining: 8, limited: false });
  });

  it('한도 도달 시 limited + retryAfterMs 계산 + 미기록(영구 lockout 방지)', () => {
    for (let i = 0; i < 10; i++) checkRateLimit(POLICY, r, i * 100);
    const blocked = checkRateLimit(POLICY, r, 1000);
    expect(blocked.limited).toBe(true);
    expect(blocked.count).toBe(10); // 미기록 — 여전히 10
    expect(blocked.remaining).toBe(0);
    // oldest=0, window=60_000 → retryAfter = 0 + 60_000 - 1000 = 59_000
    expect(blocked.retryAfterMs).toBe(59_000);
  });

  it('윈도우 밖 요청은 prune되어 다시 허용', () => {
    for (let i = 0; i < 10; i++) checkRateLimit(POLICY, r, i * 100);
    // window=60_000 — 첫 요청(t=0)이 windowStart(60_001 - 60_000 = 1) 밖으로 빠짐
    const after = checkRateLimit(POLICY, r, 60_001);
    expect(after.limited).toBe(false);
    expect(after.count).toBe(10); // 한 건 pruned + 1 새 기록 = 10
  });

  it('다중 IP 키는 독립적으로 격리', () => {
    const a = req({ 'x-forwarded-for': '203.0.113.1' });
    const b = req({ 'x-forwarded-for': '203.0.113.2' });
    for (let i = 0; i < 10; i++) checkRateLimit(POLICY, a, i);
    const aBlocked = checkRateLimit(POLICY, a, 100);
    const bFresh = checkRateLimit(POLICY, b, 100);
    expect(aBlocked.limited).toBe(true);
    expect(bFresh.limited).toBe(false);
    expect(bFresh.count).toBe(1);
  });

  it('정책별 카운터도 독립 (LOGIN과 SIGNUP)', () => {
    for (let i = 0; i < 10; i++) checkRateLimit(POLICIES.LOGIN, r, i);
    const loginBlocked = checkRateLimit(POLICIES.LOGIN, r, 100);
    const signupFresh = checkRateLimit(POLICIES.SIGNUP, r, 100);
    expect(loginBlocked.limited).toBe(true);
    expect(signupFresh.limited).toBe(false);
  });
});

describe('POLICIES catalog (BR-SEC-04)', () => {
  it('정책 카탈로그는 BR-SEC-04 사양과 정합', () => {
    expect(POLICIES.LOGIN).toMatchObject({ name: 'login', windowMs: 60_000, maxRequests: 10 });
    expect(POLICIES.SIGNUP).toMatchObject({
      name: 'signup',
      windowMs: 3_600_000,
      maxRequests: 5,
    });
    expect(POLICIES.FILE_UPLOAD).toMatchObject({
      name: 'file-upload',
      windowMs: 3_600_000,
      maxRequests: 30,
    });
  });

  it('정책 객체는 동결되어 변경 불가', () => {
    expect(() => {
      (POLICIES.LOGIN as { maxRequests: number }).maxRequests = 1000;
    }).toThrow();
  });
});

describe('withRateLimit HOF', () => {
  it('정상 응답에 X-RateLimit-* 헤더 부착', async () => {
    const wrapped = withRateLimit(POLICIES.LOGIN, async () => new NextResponse(null, { status: 200 }));
    const response = await wrapped(req({ 'x-forwarded-for': '203.0.113.10' }), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(response.headers.get('X-RateLimit-Policy')).toBe('login');
    expect(response.headers.get('Retry-After')).toBeNull(); // 한도 미초과
  });

  it('한도 초과 시 AppError SYS_RATE_LIMITED throw — withErrorHandler가 변환', async () => {
    const r = req({ 'x-forwarded-for': '203.0.113.20' });
    const noop = async () => new NextResponse(null, { status: 200 });
    const wrapped = withRateLimit(POLICIES.LOGIN, noop);
    // 10회 소진
    for (let i = 0; i < 10; i++) await wrapped(r, undefined);
    // 11번째는 throw
    await expect(wrapped(r, undefined)).rejects.toThrow(
      expect.objectContaining({ code: 'SYS_RATE_LIMITED', status: 429 }),
    );
  });

  it('throw된 AppError details에 policy 이름과 retryAfterSec 포함', async () => {
    const r = req({ 'x-forwarded-for': '203.0.113.30' });
    const wrapped = withRateLimit(
      POLICIES.LOGIN,
      async () => new NextResponse(null, { status: 200 }),
    );
    for (let i = 0; i < 10; i++) await wrapped(r, undefined);
    try {
      await wrapped(r, undefined);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const details = (err as AppError).details ?? [];
      expect(details.find((d) => d.field === 'policy')?.reason).toBe('login');
      expect(details.find((d) => d.field === 'retryAfterSec')?.reason).toMatch(/^\d+$/);
    }
  });
});

describe('__resetRateLimitStateForTesting (L-002 패턴)', () => {
  it('호출 시 모든 정책 카운터 초기화', () => {
    const r = req({ 'x-forwarded-for': '203.0.113.50' });
    for (let i = 0; i < 10; i++) checkRateLimit(POLICIES.LOGIN, r, i);
    expect(checkRateLimit(POLICIES.LOGIN, r, 100).limited).toBe(true);
    __resetRateLimitStateForTesting();
    expect(checkRateLimit(POLICIES.LOGIN, r, 100).limited).toBe(false);
  });

  it('production 환경에서 호출 시 throw (운영 안전 가드)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => __resetRateLimitStateForTesting()).toThrow(/must not be called in production/);
  });
});
