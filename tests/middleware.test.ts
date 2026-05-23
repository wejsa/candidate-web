import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { middleware } from '@/middleware';

// middleware 통합 시나리오 — HTTPS 강제 / CORS preflight / 일반 응답 헤더 부착.

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
  vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
});

function makeRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(url, { method: init.method ?? 'GET', headers: init.headers ?? {} });
}

describe('HTTPS 강제 (BR-SEC-01)', () => {
  beforeEach(() => {
    vi.stubEnv('FORCE_HTTPS_REDIRECT', 'true');
    __resetCachedEnvForTesting();
  });

  it('X-Forwarded-Proto=http 요청을 308로 https 리다이렉트', () => {
    const response = middleware(
      makeRequest('http://candidate.example.com/jobs', {
        headers: { 'x-forwarded-proto': 'http' },
      }),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://candidate.example.com/jobs');
  });

  it('X-Forwarded-Proto=https 요청은 리다이렉트하지 않는다', () => {
    const response = middleware(
      makeRequest('https://candidate.example.com/jobs', {
        headers: { 'x-forwarded-proto': 'https' },
      }),
    );
    expect(response.status).not.toBe(308);
  });

  it('다중 값의 X-Forwarded-Proto는 첫 번째 값을 사용한다', () => {
    const response = middleware(
      makeRequest('http://candidate.example.com/jobs', {
        headers: { 'x-forwarded-proto': 'https, http' },
      }),
    );
    expect(response.status).not.toBe(308);
  });

  it('FORCE_HTTPS_REDIRECT=false 시 http 요청도 통과', () => {
    vi.stubEnv('FORCE_HTTPS_REDIRECT', 'false');
    __resetCachedEnvForTesting();
    const response = middleware(
      makeRequest('http://candidate.example.com/jobs', {
        headers: { 'x-forwarded-proto': 'http' },
      }),
    );
    expect(response.status).not.toBe(308);
  });

  it('리다이렉트 응답에도 보안 헤더가 부착된다', () => {
    const response = middleware(
      makeRequest('http://candidate.example.com/jobs', {
        headers: { 'x-forwarded-proto': 'http' },
      }),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('CORS preflight (BR-SEC-03)', () => {
  it('허용 Origin OPTIONS 요청은 204 + ACAO/Methods/Headers 부착', () => {
    const response = middleware(
      makeRequest('https://candidate.example.com/api/v1/auth/login', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://candidate.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://candidate.example.com',
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('600');
    // 보안 헤더도 함께 부착되어야 한다
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('미허용 Origin OPTIONS 요청은 204지만 ACAO 미부착 (브라우저가 차단)', () => {
    const response = middleware(
      makeRequest('https://candidate.example.com/api/v1/auth/login', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example.com',
          'access-control-request-method': 'POST',
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('일반 요청 응답 가공', () => {
  it('모든 응답에 보안 헤더 + Vary: Origin이 부착된다', () => {
    const response = middleware(
      makeRequest('https://candidate.example.com/jobs', { headers: {} }),
    );
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).not.toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('허용 Origin이 동봉되면 ACAO 부착, 미허용 Origin이면 미부착', () => {
    const allowed = middleware(
      makeRequest('https://candidate.example.com/api/v1/jobs', {
        headers: { origin: 'https://candidate.example.com' },
      }),
    );
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://candidate.example.com',
    );

    const denied = middleware(
      makeRequest('https://candidate.example.com/api/v1/jobs', {
        headers: { origin: 'https://evil.example.com' },
      }),
    );
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  // production HSTS 부착은 tests/lib/security/headers.test.ts에서 단위 검증한다 — 미들웨어는 applySecurityHeaders 통과만 보장.
});
