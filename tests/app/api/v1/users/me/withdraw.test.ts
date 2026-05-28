// CANDID-022 Step 3 — POST /api/v1/users/me/withdraw 통합 테스트.
// requireAuth + withdrawUser + Rate Limit 헤더 + Set-Cookie 만료 검증.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { __resetRateLimitStateForTesting, USER_POLICIES } from '@/lib/security/rate-limit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/users/withdraw', () => ({ withdrawUser: vi.fn() }));

const { requireAuth } = (await import('@/lib/auth/middleware')) as unknown as {
  requireAuth: Mock;
};
const { withdrawUser } = (await import('@/lib/users/withdraw')) as unknown as {
  withdrawUser: Mock;
};
const { POST } = await import('@/app/api/v1/users/me/withdraw/route');

beforeEach(() => {
  vi.stubEnv('TRUST_PROXY', 'true');
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
  __resetRateLimitStateForTesting();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetRateLimitStateForTesting();
});

function postRequest(body: unknown, ip = '203.0.113.50'): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/users/me/withdraw', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'user-agent': 'vitest-ua',
    },
    body: JSON.stringify(body),
  });
}

const happyResult = {
  mode: 'anonymized' as const,
  userId: 42,
  revokedSessionCount: 2,
  withdrawnAt: new Date('2026-05-29T00:00:00Z'),
};

describe('POST /api/v1/users/me/withdraw — 정상 분기', () => {
  it('204 + Set-Cookie 만료 + user-bucket 헤더 + withdrawUser 호출 인자 전파', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    withdrawUser.mockResolvedValueOnce(happyResult);

    const response = await POST(postRequest({ passwordConfirmation: 'pw' }), undefined);

    expect(response.status).toBe(204);
    // Body 없음 (BR-PII-02 — 분기/카운트 비공개)
    expect(await response.text()).toBe('');

    // Set-Cookie: access_token + refresh_token 만료
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/access_token=;/);
    expect(setCookie).toMatch(/refresh_token=;/);
    expect(setCookie).toMatch(/Max-Age=0/);

    // user-bucket 헤더
    expect(response.headers.get('X-RateLimit-Policy')).toBe(USER_POLICIES.WITHDRAW_USER.name);

    // withdrawUser 호출 인자 검증 — userAgent/ipAddress 박제
    expect(withdrawUser).toHaveBeenCalledWith({
      userId: 42,
      passwordConfirmation: 'pw',
      reason: undefined,
      userAgent: 'vitest-ua',
      ipAddress: null,
    });
  });

  it('reason 전달 — withdrawUser에 trim된 값 전파 (zod transform)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 7 });
    withdrawUser.mockResolvedValueOnce({ ...happyResult, userId: 7 });

    await POST(postRequest({ passwordConfirmation: 'pw', reason: '  여러 이유  ' }), undefined);

    expect(withdrawUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, reason: '여러 이유' }),
    );
  });
});

describe('POST /api/v1/users/me/withdraw — 인증/검증 에러', () => {
  it('미인증 → requireAuth가 AUTH_TOKEN_INVALID throw → 401', async () => {
    requireAuth.mockRejectedValueOnce(new AppError('AUTH_TOKEN_INVALID'));
    const response = await POST(postRequest({}), undefined);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('AUTH_TOKEN_INVALID');
    expect(withdrawUser).not.toHaveBeenCalled();
  });

  it('zod 위반 (passwordConfirmation 257자) → 400 SYS_VALIDATION_FAILED', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    const response = await POST(
      postRequest({ passwordConfirmation: 'x'.repeat(257) }),
      undefined,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(withdrawUser).not.toHaveBeenCalled();
  });

  it('zod 위반 (여분 키 strict) → 400', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    const response = await POST(
      postRequest({ passwordConfirmation: 'pw', extraneous: 'evil' }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(withdrawUser).not.toHaveBeenCalled();
  });

  // H001 fix (review): reason 500자 경계 회귀 가드 — zod .max(500) 정확성 검증.
  it('reason 501자 → 400 SYS_VALIDATION_FAILED (max 500 경계)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    const response = await POST(
      postRequest({ passwordConfirmation: 'pw', reason: 'x'.repeat(501) }),
      undefined,
    );
    expect(response.status).toBe(400);
    expect(withdrawUser).not.toHaveBeenCalled();
  });

  it('reason 정확히 500자 → 통과 (withdrawUser 호출)', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    withdrawUser.mockResolvedValueOnce(happyResult);
    const response = await POST(
      postRequest({ passwordConfirmation: 'pw', reason: 'x'.repeat(500) }),
      undefined,
    );
    expect(response.status).toBe(204);
    expect(withdrawUser).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'x'.repeat(500) }),
    );
  });
});

describe('POST /api/v1/users/me/withdraw — withdrawUser 에러 전파', () => {
  beforeEach(() => {
    requireAuth.mockResolvedValue({ userId: 42 });
  });

  it.each([
    ['USER_ALREADY_WITHDRAWN', 409],
    ['USER_PASSWORD_RECONFIRM_REQUIRED', 422],
    ['USER_REAUTH_REQUIRED', 422],
    ['AUTH_INVALID_CREDENTIALS', 401],
    ['USER_NOT_FOUND', 404],
  ] as const)('%s → %d', async (code, status) => {
    withdrawUser.mockRejectedValueOnce(new AppError(code));
    const response = await POST(
      postRequest({ passwordConfirmation: 'pw' }),
      undefined,
    );
    expect(response.status).toBe(status);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe(code);
  });
});

describe('POST /api/v1/users/me/withdraw — Rate Limit', () => {
  it('user-bucket 4회째 → 429 SYS_RATE_LIMITED + Retry-After', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    withdrawUser.mockResolvedValue(happyResult);

    // 정상 3회 — 한도 도달
    for (let i = 0; i < USER_POLICIES.WITHDRAW_USER.maxRequests; i++) {
      const ok = await POST(postRequest({ passwordConfirmation: 'pw' }), undefined);
      expect(ok.status).toBe(204);
    }
    // 4회째 — 한도 초과
    const limited = await POST(postRequest({ passwordConfirmation: 'pw' }), undefined);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { code: string };
    expect(body.code).toBe('SYS_RATE_LIMITED');
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    expect(limited.headers.get('X-RateLimit-Policy')).toBe(USER_POLICIES.WITHDRAW_USER.name);

    // withdrawUser는 정상 3회만 호출됨 — 한도 초과는 비즈니스 진입 전 차단
    expect(withdrawUser).toHaveBeenCalledTimes(USER_POLICIES.WITHDRAW_USER.maxRequests);
  });

  // H002 fix (review): 테스트 의도 명확화 — 동일 사용자 4회는 user-bucket(3/시간)이 IP-bucket(LOGIN 10/분)보다
  // 먼저 적중. 정책 우선순위(inner user-bucket이 outer IP-bucket보다 먼저 차단) 회귀 가드.
  // IP-bucket 단독 적중(4명 사용자 × 10회 동일 IP)은 별도 무관 테스트로 분리 권장 (CANDID-022 FU).
  it('정책 우선순위 회귀: user-bucket(3/시간)이 IP-bucket(LOGIN 10/분)보다 먼저 적중', async () => {
    requireAuth.mockResolvedValue({ userId: 42 });
    withdrawUser.mockResolvedValue(happyResult);

    for (let i = 0; i < 3; i++) {
      await POST(postRequest({ passwordConfirmation: 'pw' }, '198.51.100.1'), undefined);
    }
    const limited = await POST(
      postRequest({ passwordConfirmation: 'pw' }, '198.51.100.1'),
      undefined,
    );
    // 4번째는 user-bucket이 IP-bucket(아직 6회 여유)보다 먼저 차단 — 정책명 회귀 가드.
    expect(limited.status).toBe(429);
    expect(limited.headers.get('X-RateLimit-Policy')).toBe(USER_POLICIES.WITHDRAW_USER.name);
  });
});

describe('POST /api/v1/users/me/withdraw — BR-PII-02 응답 누설 회귀 가드', () => {
  it('204 응답 body는 빈 문자열 — mode/userId/revokedSessionCount 등 분기 정보 미노출', async () => {
    requireAuth.mockResolvedValueOnce({ userId: 42 });
    withdrawUser.mockResolvedValueOnce(happyResult);
    const response = await POST(postRequest({ passwordConfirmation: 'pw' }), undefined);
    const text = await response.text();
    expect(text).toBe('');
    expect(text).not.toContain('anonymized');
    expect(text).not.toContain('hard_deleted');
  });
});
