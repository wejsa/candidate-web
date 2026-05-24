import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { POLICIES, __resetRateLimitStateForTesting } from '@/lib/security/rate-limit';

// CANDID-011 Step 2 — POST /api/v1/auth/login 라우터 통합 테스트.
// signin은 mock — 라우터의 status/Cookie/응답 본문/rate-limit/표준 7필드만 검증.
// 통합(실 DB) 검증은 별도 integration 테스트.

vi.mock('@/lib/auth/login', () => ({
  signin: vi.fn(),
}));

const { signin } = (await import('@/lib/auth/login')) as unknown as { signin: Mock };
const { POST } = await import('@/app/api/v1/auth/login/route');

beforeEach(() => {
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
  email: 'user@example.com',
  password: 'CorrectHorse!23',
  rememberMe: false,
};

const successResult = {
  user: { id: 42, email: 'user@example.com', name: '홍길동', emailVerifiedAt: null },
  tokens: {
    accessToken: 'access-jwt-fake',
    accessExpiresAt: new Date('2026-06-01T00:00:00Z'),
    refreshToken: 'refresh-jwt-fake',
    refreshExpiresAt: new Date('2026-06-15T00:00:00Z'),
  },
};

function postRequest(body: unknown, ip = '203.0.113.10'): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'user-agent': 'vitest',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/auth/login — 정상', () => {
  it('200 + user 응답 + Set-Cookie 2종(access/refresh)', async () => {
    signin.mockResolvedValueOnce(successResult);
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      user: { id: 42, email: 'user@example.com', name: '홍길동', emailVerifiedAt: null },
    });

    // 평문 토큰은 응답에 노출 금지 (Cookie로만 전달)
    expect(body).not.toHaveProperty('tokens');
    expect(JSON.stringify(body)).not.toContain('access-jwt-fake');
    expect(JSON.stringify(body)).not.toContain('refresh-jwt-fake');

    // PII (passwordHash/phone/birthDate) 응답 미포함 회귀 가드
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('phone');
    expect(body.user).not.toHaveProperty('birthDate');

    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('access_token=access-jwt-fake'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('refresh_token=refresh-jwt-fake'))).toBe(true);

    // Cookie 보안 속성 명시 검증
    const accessCookie = setCookies.find((c) => c.startsWith('access_token='));
    expect(accessCookie).toContain('HttpOnly');
    expect(accessCookie).toContain('SameSite=lax');
    expect(accessCookie).toContain('Path=/');
    const refreshCookie = setCookies.find((c) => c.startsWith('refresh_token='));
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=lax');
  });

  it('X-RateLimit-* 헤더 부착 (POLICIES.LOGIN — IP 10회/분)', async () => {
    signin.mockResolvedValueOnce(successResult);
    const response = await POST(postRequest(validBody), undefined);
    expect(response.headers.get('X-RateLimit-Limit')).toBe(
      String(POLICIES.LOGIN.maxRequests),
    );
    expect(response.headers.get('X-RateLimit-Policy')).toBe(POLICIES.LOGIN.name);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe(
      String(POLICIES.LOGIN.maxRequests - 1),
    );
  });

  it('signin에 user-agent + ipAddress 컨텍스트 전달 (감사 로그 메타)', async () => {
    signin.mockResolvedValueOnce(successResult);
    await POST(postRequest(validBody), undefined);
    expect(signin).toHaveBeenCalledTimes(1);
    const [input, opts] = signin.mock.calls[0] ?? [];
    expect(input).toEqual(validBody);
    expect(opts).toMatchObject({ userAgent: 'vitest', ipAddress: null });
  });

  it('rememberMe=true 전달 → signin input.rememberMe 그대로', async () => {
    signin.mockResolvedValueOnce(successResult);
    await POST(postRequest({ ...validBody, rememberMe: true }), undefined);
    const [input] = signin.mock.calls[0] ?? [];
    expect(input).toMatchObject({ rememberMe: true });
  });
});

describe('POST /api/v1/auth/login — 검증 실패', () => {
  it('이메일 형식 오류 → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await POST(postRequest({ ...validBody, email: 'not-an-email' }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(signin).not.toHaveBeenCalled();
  });

  it('비밀번호 누락 → 400 SYS_VALIDATION_FAILED', async () => {
    const response = await POST(
      postRequest({ email: 'user@example.com', password: '' }),
      undefined,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(signin).not.toHaveBeenCalled();
  });

  it('email은 소문자로 정규화 → signin input.email 검증', async () => {
    signin.mockResolvedValueOnce(successResult);
    await POST(postRequest({ ...validBody, email: 'User@EXAMPLE.com' }), undefined);
    const [input] = signin.mock.calls[0] ?? [];
    expect(input?.email).toBe('user@example.com');
  });

  it('IDN homograph 도메인 (키릴) → 400 SYS_VALIDATION_FAILED', async () => {
    // 도메인에 키릴 'а' 포함 — IDN 사칭 차단 (SignupInputSchema와 동일 규칙)
    const cyrillicEmail = 'user@gmаиl.com'; // 'gm' + Cyrillic 'а' + 'il.com'
    const response = await POST(postRequest({ ...validBody, email: cyrillicEmail }), undefined);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
  });
});

describe('POST /api/v1/auth/login — 비즈니스 에러 (계정 열거 방지)', () => {
  it('이메일/비밀번호 불일치 → 401 AUTH_INVALID_CREDENTIALS + 표준 7필드', async () => {
    signin.mockRejectedValueOnce(new AppError('AUTH_INVALID_CREDENTIALS'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
      message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      path: '/api/v1/auth/login',
    });
    // 표준 7필드 검증
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/i);

    // 실패 시 Set-Cookie 미부착 회귀 가드
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(0);
  });

  it('5회 실패 후 잠금 → 429 AUTH_ACCOUNT_LOCKED', async () => {
    signin.mockRejectedValueOnce(new AppError('AUTH_ACCOUNT_LOCKED'));
    const response = await POST(postRequest(validBody), undefined);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'AUTH_ACCOUNT_LOCKED',
      status: 429,
      message: '로그인 시도가 많아 계정이 일시 잠겼습니다. 잠시 후 다시 시도해 주세요.',
      path: '/api/v1/auth/login',
    });
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(0);
  });
});

describe('POST /api/v1/auth/login — Rate Limit (BR-SEC-04 10회/분/IP)', () => {
  it('N+1번째 요청은 429 SYS_RATE_LIMITED + Retry-After + 정책 헤더', async () => {
    const limit = POLICIES.LOGIN.maxRequests;
    signin.mockResolvedValue(successResult);

    // 한도까지 통과
    for (let i = 0; i < limit; i++) {
      const ok = await POST(postRequest(validBody, '203.0.113.55'), undefined);
      expect(ok.status).toBe(200);
    }

    // 한도+1번째 → 429
    const blocked = await POST(postRequest(validBody, '203.0.113.55'), undefined);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('SYS_RATE_LIMITED');
    expect(blocked.headers.get('X-RateLimit-Policy')).toBe(POLICIES.LOGIN.name);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe(String(limit));
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('Retry-After')).not.toBeNull();

    // RL 차단 시점에는 signin 미호출
    expect(signin).toHaveBeenCalledTimes(limit);
  });

  it('다른 IP는 격리된 카운터 (NAT 환경 다수 사용자 보호)', async () => {
    const limit = POLICIES.LOGIN.maxRequests;
    signin.mockResolvedValue(successResult);

    // IP A: 한도 소진
    for (let i = 0; i < limit; i++)
      await POST(postRequest(validBody, '1.1.1.1'), undefined);
    const blockedA = await POST(postRequest(validBody, '1.1.1.1'), undefined);
    expect(blockedA.status).toBe(429);

    // IP B: 영향 없음
    const okB = await POST(postRequest(validBody, '2.2.2.2'), undefined);
    expect(okB.status).toBe(200);
  });
});
