import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import {
  __resetCorsCacheForTesting,
  applyCorsHeaders,
  buildPreflightResponse,
  getAllowedOrigins,
  resolveAllowedOrigin,
} from '@/lib/security/cors';

beforeEach(() => {
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetCorsCacheForTesting();
});

function preflightRequest(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

describe('getAllowedOrigins', () => {
  it('NEXT_PUBLIC_APP_URL의 origin이 항상 자동 포함된다', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com/some/path');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    __resetCachedEnvForTesting();
    __resetCorsCacheForTesting();
    const allowed = getAllowedOrigins();
    expect([...allowed]).toEqual(['https://candidate.example.com']);
  });

  it('CSV 추가 origin은 origin 단위로 정규화되어 합쳐진다 (path/trailing slash 제거)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
    vi.stubEnv(
      'CORS_ALLOWED_ORIGINS',
      'https://staging.example.com/path , https://preview.example.com/',
    );
    __resetCachedEnvForTesting();
    __resetCorsCacheForTesting();
    expect(getAllowedOrigins()).toEqual(
      new Set([
        'https://candidate.example.com',
        'https://staging.example.com',
        'https://preview.example.com',
      ]),
    );
  });

  it('빈 항목과 잘못된 URL은 무시한다 (이중 방어)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://ok.example.com,,not-a-url,   ');
    __resetCachedEnvForTesting();
    __resetCorsCacheForTesting();
    expect(getAllowedOrigins()).toEqual(
      new Set(['http://localhost:3000', 'https://ok.example.com']),
    );
  });

  it('반복 호출 시 캐시되고 동일 참조를 반환한다', () => {
    const a = getAllowedOrigins();
    const b = getAllowedOrigins();
    expect(a).toBe(b);
  });
});

describe('resolveAllowedOrigin', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://staging.example.com');
  });

  it('허용/거부/빈 입력을 분기 처리한다', () => {
    expect(resolveAllowedOrigin('https://candidate.example.com')).toBe(
      'https://candidate.example.com',
    );
    expect(resolveAllowedOrigin('https://staging.example.com')).toBe(
      'https://staging.example.com',
    );
    expect(resolveAllowedOrigin('https://evil.example.com')).toBeNull();
    expect(resolveAllowedOrigin(null)).toBeNull();
    expect(resolveAllowedOrigin('')).toBeNull();
  });
});

describe('applyCorsHeaders', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    __resetCachedEnvForTesting();
    __resetCorsCacheForTesting();
  });

  it('허용된 Origin에는 ACAO + Credentials + Vary 부착', () => {
    const response = new NextResponse(null, { status: 200 });
    applyCorsHeaders(response, 'https://candidate.example.com');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://candidate.example.com',
    );
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('미허용 Origin에는 ACAO 부착하지 않지만 Vary는 부착 (캐시 분리)', () => {
    const response = new NextResponse(null, { status: 200 });
    applyCorsHeaders(response, 'https://evil.example.com');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('Vary append: 기존 값 보존 + Origin 중복 방지 (case-insensitive)', () => {
    const append = new NextResponse(null, { status: 200 });
    append.headers.set('Vary', 'Accept-Encoding');
    applyCorsHeaders(append, null);
    expect(append.headers.get('Vary')).toBe('Accept-Encoding, Origin');

    const dedupe = new NextResponse(null, { status: 200 });
    dedupe.headers.set('Vary', 'origin, Accept-Encoding');
    applyCorsHeaders(dedupe, null);
    expect(dedupe.headers.get('Vary')).toBe('origin, Accept-Encoding');
  });
});

describe('buildPreflightResponse', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    __resetCachedEnvForTesting();
    __resetCorsCacheForTesting();
  });

  it('허용 Origin: 204 + Allow-Methods/Headers/Max-Age 부착', () => {
    const response = buildPreflightResponse(
      preflightRequest({
        origin: 'https://candidate.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, idempotency-key',
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://candidate.example.com',
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'content-type, idempotency-key',
    );
    expect(response.headers.get('Access-Control-Max-Age')).toBe('600');
  });

  it('Allow-Methods/Headers 누락 시 안전한 기본값 적용', () => {
    const response = buildPreflightResponse(
      preflightRequest({ origin: 'https://candidate.example.com' }),
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Authorization, Idempotency-Key',
    );
  });

  it('미허용 Origin: 204 응답이지만 ACAO/Methods/Headers 부착하지 않음 (브라우저 차단)', () => {
    const response = buildPreflightResponse(
      preflightRequest({
        origin: 'https://evil.example.com',
        'access-control-request-method': 'POST',
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Methods')).toBeNull();
    expect(response.headers.get('Access-Control-Max-Age')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('Origin 헤더 자체가 없으면 ACAO 미부착', () => {
    const response = buildPreflightResponse(preflightRequest({}));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
