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
    // VERIFY_EMAIL — CANDID-036에서 추가 (PR #33 H005, 무제한 POST DoS 차단).
    // 본 테스트가 fail하면: 신규 정책 정당하면 화이트리스트 갱신, FILE_UPLOAD라면 시그니처 확장 동반 필수.
    expect(Object.keys(POLICIES).sort()).toEqual(['LOGIN', 'SIGNUP', 'VERIFY_EMAIL']);
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

// =====================================================================
// CANDID-036 추가 — VERIFY_EMAIL IP 정책 + USER_POLICIES + withUserRateLimit
// =====================================================================

describe('CANDID-036 — POLICIES.VERIFY_EMAIL (IP 30회/분)', () => {
  beforeEach(() => {
    vi.stubEnv('TRUST_PROXY', 'true');
    __resetCachedEnvForTesting();
  });

  it('정의 검증 — 30회/분/IP, IP keyExtractor', async () => {
    const { POLICIES: pol } = await import('@/lib/security/rate-limit');
    expect(pol.VERIFY_EMAIL.name).toBe('verify_email');
    expect(pol.VERIFY_EMAIL.windowMs).toBe(60_000);
    expect(pol.VERIFY_EMAIL.maxRequests).toBe(30);
    expect(pol.VERIFY_EMAIL.keyExtractor).toBe(rateLimitKeyByIp);
  });

  it('30회까지 통과, 31회째 차단', () => {
    const r = req({ 'x-forwarded-for': '203.0.113.99' });
    for (let i = 0; i < 30; i++) {
      const p = checkRateLimit(POLICIES.VERIFY_EMAIL, r, i);
      expect(p.limited).toBe(false);
    }
    const blocked = checkRateLimit(POLICIES.VERIFY_EMAIL, r, 100);
    expect(blocked.limited).toBe(true);
  });
});

describe('CANDID-036 — USER_POLICIES.RESEND_VERIFICATION_USER (user 3회/시간)', () => {
  it('정의 검증 — 3회/시간/user, keyExtractor 없음', async () => {
    const { USER_POLICIES } = await import('@/lib/security/rate-limit');
    expect(USER_POLICIES.RESEND_VERIFICATION_USER.name).toBe('resend_verification_user');
    expect(USER_POLICIES.RESEND_VERIFICATION_USER.windowMs).toBe(3_600_000);
    expect(USER_POLICIES.RESEND_VERIFICATION_USER.maxRequests).toBe(3);
    expect('keyExtractor' in USER_POLICIES.RESEND_VERIFICATION_USER).toBe(false);
  });
});

describe('CANDID-022 Step 3 — USER_POLICIES.WITHDRAW_USER (user 3회/시간)', () => {
  it('정의 검증 — 3회/시간/user, keyExtractor 없음 (비밀번호 brute force + 다중 호출 차단)', async () => {
    const { USER_POLICIES } = await import('@/lib/security/rate-limit');
    expect(USER_POLICIES.WITHDRAW_USER.name).toBe('withdraw_user');
    expect(USER_POLICIES.WITHDRAW_USER.windowMs).toBe(3_600_000);
    expect(USER_POLICIES.WITHDRAW_USER.maxRequests).toBe(3);
    expect('keyExtractor' in USER_POLICIES.WITHDRAW_USER).toBe(false);
  });
});

describe('CANDID-036 — checkUserRateLimit', () => {
  it('3회 통과, 4회째 차단 (동일 userId)', async () => {
    const { USER_POLICIES, checkUserRateLimit } = await import('@/lib/security/rate-limit');
    const policy = USER_POLICIES.RESEND_VERIFICATION_USER;
    for (let i = 0; i < 3; i++) {
      expect(checkUserRateLimit(policy, 42, i).limited).toBe(false);
    }
    const blocked = checkUserRateLimit(policy, 42, 100);
    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('다른 userId는 격리된 카운터', async () => {
    const { USER_POLICIES, checkUserRateLimit } = await import('@/lib/security/rate-limit');
    const policy = USER_POLICIES.RESEND_VERIFICATION_USER;
    // user A가 한도 채움
    for (let i = 0; i < 3; i++) checkUserRateLimit(policy, 'A', i);
    expect(checkUserRateLimit(policy, 'A', 100).limited).toBe(true);
    // user B는 영향 없음
    expect(checkUserRateLimit(policy, 'B', 100).limited).toBe(false);
  });

  it('윈도우 경과 후 카운터 초기화', async () => {
    const { USER_POLICIES, checkUserRateLimit } = await import('@/lib/security/rate-limit');
    const policy = USER_POLICIES.RESEND_VERIFICATION_USER;
    const W = policy.windowMs;
    for (let i = 0; i < 3; i++) checkUserRateLimit(policy, 99, i);
    expect(checkUserRateLimit(policy, 99, 10).limited).toBe(true);
    // windowMs + 1ms 경과 → 전부 prune
    expect(checkUserRateLimit(policy, 99, W + 100).limited).toBe(false);
  });
});

describe('CANDID-036 — withUserRateLimit', () => {
  it('한도 내 — handler 호출 + 200 + X-RateLimit-* 헤더 부착', async () => {
    const { USER_POLICIES, withUserRateLimit } = await import('@/lib/security/rate-limit');
    const handler = vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, 42, handler);

    const response = await wrapped(req(), undefined);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(response.headers.get('X-RateLimit-Policy')).toBe('resend_verification_user');
  });

  it('한도 초과 — handler 미호출 + 429 + Retry-After', async () => {
    const { USER_POLICIES, withUserRateLimit, checkUserRateLimit } =
      await import('@/lib/security/rate-limit');
    // 한도 사전 소진
    for (let i = 0; i < 3; i++) checkUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, 7);

    const handler = vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, 7, handler);

    const response = await wrapped(req(), undefined);
    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
    expect(response.headers.get('Retry-After')).not.toBeNull();
    expect(response.headers.get('X-RateLimit-Policy')).toBe('resend_verification_user');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    const body = await response.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');
  });
});

// =====================================================================
// CANDID-037 추가 — L-023 wrapper override 가드 + enforceUserRateLimit
// =====================================================================

describe('CANDID-037 — withRateLimit L-023 헤더 override 가드', () => {
  beforeEach(() => {
    vi.stubEnv('TRUST_PROXY', 'true');
    __resetCachedEnvForTesting();
  });

  it('inner가 부착한 X-RateLimit-Policy를 outer가 덮어쓰지 않음 (L-023)', async () => {
    // 시나리오: inner가 user-bucket 헤더를 먼저 부착 → outer withRateLimit이 후속 호출 시 가드.
    const wrapped = withRateLimit(POLICIES.SIGNUP, async () => {
      const resp = new NextResponse(null, { status: 200 });
      // inner wrapper가 user-bucket 헤더를 부착한 상황을 시뮬레이션.
      resp.headers.set('X-RateLimit-Limit', '3');
      resp.headers.set('X-RateLimit-Remaining', '2');
      resp.headers.set('X-RateLimit-Policy', 'resend_verification_user');
      return resp;
    });

    const response = await wrapped(req({ 'x-forwarded-for': '203.0.113.30' }), undefined);
    expect(response.status).toBe(200);
    // inner 헤더가 보존되어야 한다 (정책 식별자가 클라이언트 backoff에 더 유용).
    expect(response.headers.get('X-RateLimit-Policy')).toBe('resend_verification_user');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('2');
  });

  it('inner 헤더 부재 시 outer가 정상 부착 (가드는 폴백을 막지 않음)', async () => {
    const wrapped = withRateLimit(
      POLICIES.SIGNUP,
      async () => new NextResponse(null, { status: 200 }),
    );
    const response = await wrapped(req({ 'x-forwarded-for': '203.0.113.31' }), undefined);
    expect(response.headers.get('X-RateLimit-Policy')).toBe('signup');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
  });

  it('429 응답에 inner 헤더가 있으면 outer가 보존 (inner가 limited인 합성 경로)', async () => {
    // outer 정상 통과 + inner가 자체 429 응답 반환한 경우.
    const wrapped = withRateLimit(POLICIES.SIGNUP, async () => {
      const resp = new NextResponse(JSON.stringify({ code: 'SYS_RATE_LIMITED' }), {
        status: 429,
        headers: {
          'X-RateLimit-Limit': '3',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Policy': 'resend_verification_user',
          'Retry-After': '120',
        },
      });
      return resp;
    });
    const response = await wrapped(req({ 'x-forwarded-for': '203.0.113.32' }), undefined);
    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Policy')).toBe('resend_verification_user');
    expect(response.headers.get('Retry-After')).toBe('120');
  });
});

describe('CANDID-037 — enforceUserRateLimit (인라인 헬퍼)', () => {
  beforeEach(() => {
    vi.stubEnv('TRUST_PROXY', 'true');
    __resetCachedEnvForTesting();
  });

  it('정상 path — response=null + attachHeaders가 외부 응답에 헤더 부착', async () => {
    const { USER_POLICIES, enforceUserRateLimit } = await import('@/lib/security/rate-limit');

    const gate = enforceUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, 42, req());
    expect(gate.response).toBeNull();

    const finalResponse = NextResponse.json({ ok: true }, { status: 200 });
    gate.attachHeaders(finalResponse);

    expect(finalResponse.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(finalResponse.headers.get('X-RateLimit-Remaining')).toBe('2');
    expect(finalResponse.headers.get('X-RateLimit-Policy')).toBe('resend_verification_user');
    expect(finalResponse.headers.get('Retry-After')).toBeNull();
  });

  it('한도 초과 — response가 429 + Retry-After (호출자가 즉시 반환)', async () => {
    const { USER_POLICIES, enforceUserRateLimit, checkUserRateLimit } = await import(
      '@/lib/security/rate-limit'
    );
    // 한도 사전 소진
    for (let i = 0; i < 3; i++)
      checkUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, 99);

    const gate = enforceUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, 99, req());
    expect(gate.response).not.toBeNull();
    expect(gate.response?.status).toBe(429);
    expect(gate.response?.headers.get('X-RateLimit-Policy')).toBe('resend_verification_user');
    expect(gate.response?.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(gate.response?.headers.get('Retry-After')).not.toBeNull();

    const body = await gate.response?.json();
    expect(body?.code).toBe('SYS_RATE_LIMITED');
  });

  it('attachHeaders는 멱등 — 두 번 호출해도 헤더 값 변하지 않음', async () => {
    const { USER_POLICIES, enforceUserRateLimit } = await import('@/lib/security/rate-limit');
    const gate = enforceUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, 'idem-1', req());
    const finalResponse = NextResponse.json({ ok: true });
    gate.attachHeaders(finalResponse);
    gate.attachHeaders(finalResponse); // L-023 가드 — 두 번째 호출은 no-op
    expect(finalResponse.headers.get('X-RateLimit-Remaining')).toBe('2');
    expect(finalResponse.headers.get('X-RateLimit-Policy')).toBe('resend_verification_user');
  });

  it('L-023 합성 — enforceUserRateLimit attach 후 외부 withRateLimit이 헤더 보존', async () => {
    const { USER_POLICIES, enforceUserRateLimit } = await import('@/lib/security/rate-limit');

    const outerWrapped = withRateLimit(POLICIES.SIGNUP, async (request) => {
      const gate = enforceUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, 'L023', request);
      if (gate.response !== null) return gate.response;
      const finalResponse = NextResponse.json({ ok: true }, { status: 200 });
      gate.attachHeaders(finalResponse);
      return finalResponse;
    });

    const response = await outerWrapped(req({ 'x-forwarded-for': '203.0.113.40' }), undefined);
    expect(response.status).toBe(200);
    // user-bucket 헤더가 outer SIGNUP 헤더보다 우선 (L-023 가드 동작).
    expect(response.headers.get('X-RateLimit-Policy')).toBe('resend_verification_user');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('3');
  });
});
