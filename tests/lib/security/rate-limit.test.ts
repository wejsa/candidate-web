import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import {
  __resetRateLimitStateForTesting,
  POLICIES,
  checkRateLimit,
  rateLimitKeyByIp,
  withRateLimit,
} from '@/lib/security/rate-limit';

beforeEach(() => {
  __resetRateLimitStateForTesting();
  __resetCachedEnvForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetRateLimitStateForTesting();
  __resetCachedEnvForTesting();
});

function req(headers: Record<string, string> = {}, method = 'POST'): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/login', { method, headers });
}

describe('rateLimitKeyByIp (MAJOR-SEC-1 보강 — TRUST_PROXY 분리)', () => {
  describe('TRUST_PROXY=true (LB/CDN 뒤)', () => {
    beforeEach(() => {
      vi.stubEnv('TRUST_PROXY', 'true');
      __resetCachedEnvForTesting();
    });

    it('X-Forwarded-For 첫 번째 IP 우선', () => {
      expect(rateLimitKeyByIp(req({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }))).toBe(
        'ip:203.0.113.10',
      );
    });

    it('X-Forwarded-For 부재 시 X-Real-IP 폴백', () => {
      expect(rateLimitKeyByIp(req({ 'x-real-ip': '198.51.100.5' }))).toBe('ip:198.51.100.5');
    });

    it('X-Forwarded-For 공백 항목은 무시', () => {
      expect(rateLimitKeyByIp(req({ 'x-forwarded-for': '  ' }))).toBe('ip:unknown');
    });
  });

  describe('TRUST_PROXY=false (기본/직접 노출)', () => {
    it('X-Forwarded-For 위조는 무시 — 위조 IP들이 동일 키로 수렴해야 우회 불가', () => {
      const a = req({ 'x-forwarded-for': '1.1.1.1' });
      const b = req({ 'x-forwarded-for': '2.2.2.2' });
      expect(rateLimitKeyByIp(a)).toBe(rateLimitKeyByIp(b)); // 둘 다 'ip:unknown'
    });

    it('X-Real-IP 위조도 무시', () => {
      expect(rateLimitKeyByIp(req({ 'x-real-ip': '198.51.100.5' }))).toBe('ip:unknown');
    });
  });

  it('헤더 모두 부재 시 unknown 키 반환', () => {
    expect(rateLimitKeyByIp(req())).toBe('ip:unknown');
  });
});

describe('checkRateLimit — sliding window', () => {
  const POLICY = POLICIES.LOGIN; // 10/min/IP

  beforeEach(() => {
    vi.stubEnv('TRUST_PROXY', 'true'); // 테스트는 LB 환경 가정으로 X-Forwarded-For 신뢰
    __resetCachedEnvForTesting();
  });

  const r = () => req({ 'x-forwarded-for': '203.0.113.1' });

  it('한도 미만 요청은 not limited + remaining 감소', () => {
    const p1 = checkRateLimit(POLICY, r(), 0);
    expect(p1).toMatchObject({ count: 1, remaining: 9, limited: false, retryAfterMs: 0 });
    const p2 = checkRateLimit(POLICY, r(), 100);
    expect(p2).toMatchObject({ count: 2, remaining: 8, limited: false });
  });

  it('한도 도달 시 limited + retryAfterMs 계산 + 미기록(영구 lockout 방지)', () => {
    for (let i = 0; i < 10; i++) checkRateLimit(POLICY, r(), i * 100);
    const blocked = checkRateLimit(POLICY, r(), 1000);
    expect(blocked.limited).toBe(true);
    expect(blocked.count).toBe(10);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(59_000);
  });

  it('윈도우 밖 요청은 prune되어 다시 허용', () => {
    for (let i = 0; i < 10; i++) checkRateLimit(POLICY, r(), i * 100);
    const after = checkRateLimit(POLICY, r(), 60_001);
    expect(after.limited).toBe(false);
    expect(after.count).toBe(10);
  });

  it('다중 IP 키는 독립적으로 격리 (TRUST_PROXY=true에서만 의미)', () => {
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
    for (let i = 0; i < 10; i++) checkRateLimit(POLICIES.LOGIN, r(), i);
    const loginBlocked = checkRateLimit(POLICIES.LOGIN, r(), 100);
    const signupFresh = checkRateLimit(POLICIES.SIGNUP, r(), 100);
    expect(loginBlocked.limited).toBe(true);
    expect(signupFresh.limited).toBe(false);
  });
});

describe('POLICIES catalog (BR-SEC-04)', () => {
  it('정책 카탈로그 키 화이트리스트 — 신규 정책 추가는 의도적 변경 강제 (C001 회귀 가드)', () => {
    // FILE_UPLOAD는 (request, AuthContext) 시그니처 확장 후 CANDID-016에서 정의.
    // 본 테스트가 fail하면: 신규 정책 정당하면 화이트리스트 갱신, FILE_UPLOAD라면 시그니처 확장 동반 필수.
    expect(Object.keys(POLICIES).sort()).toEqual(['LOGIN', 'SIGNUP']);
  });

  it('정책 카탈로그는 BR-SEC-04 사양(LOGIN/SIGNUP)과 정합', () => {
    expect(POLICIES.LOGIN).toMatchObject({ name: 'login', windowMs: 60_000, maxRequests: 10 });
    expect(POLICIES.SIGNUP).toMatchObject({ name: 'signup', windowMs: 3_600_000, maxRequests: 5 });
  });

  it('정책 객체는 동결되어 변경 불가', () => {
    expect(() => {
      (POLICIES.LOGIN as { maxRequests: number }).maxRequests = 1000;
    }).toThrow();
  });
});

describe('withRateLimit HOF', () => {
  beforeEach(() => {
    vi.stubEnv('TRUST_PROXY', 'true');
    __resetCachedEnvForTesting();
  });

  it('정상 응답에 X-RateLimit-* 헤더 부착', async () => {
    const wrapped = withRateLimit(
      POLICIES.LOGIN,
      async () => new NextResponse(null, { status: 200 }),
    );
    const response = await wrapped(req({ 'x-forwarded-for': '203.0.113.10' }), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(response.headers.get('X-RateLimit-Policy')).toBe('login');
    expect(response.headers.get('Retry-After')).toBeNull();
  });

  it('한도 초과 시 표준 429 응답 + Retry-After/X-RateLimit-* 헤더 부착 (H001 — RFC 6585)', async () => {
    const r = req({ 'x-forwarded-for': '203.0.113.20' });
    const wrapped = withRateLimit(
      POLICIES.LOGIN,
      async () => new NextResponse(null, { status: 200 }),
    );
    for (let i = 0; i < 10; i++) await wrapped(r, undefined);

    const blocked = await wrapped(r, undefined);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { code: string; details?: unknown[] };
    expect(body.code).toBe('SYS_RATE_LIMITED');
    // H002 — 운영 메타데이터는 헤더 채널로 노출. details에 policy/retryAfterSec 미포함.
    expect(body.details).toBeUndefined();
    // H001 — 표준 헤더 부착
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('X-RateLimit-Policy')).toBe('login');
  });
});

describe('__resetRateLimitStateForTesting (L-002 패턴)', () => {
  beforeEach(() => {
    vi.stubEnv('TRUST_PROXY', 'true');
    __resetCachedEnvForTesting();
  });

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
