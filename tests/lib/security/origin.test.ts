import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetCorsCacheForTesting } from '@/lib/security/cors';
import { assertAllowedOrigin, isStateChangingMethod } from '@/lib/security/origin';

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

function req(method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://candidate.example.com/api/v1/auth/login', { method, headers });
}

describe('isStateChangingMethod', () => {
  it('POST/PUT/PATCH/DELETE는 true', () => {
    expect(isStateChangingMethod('POST')).toBe(true);
    expect(isStateChangingMethod('put')).toBe(true);
    expect(isStateChangingMethod('Patch')).toBe(true);
    expect(isStateChangingMethod('DELETE')).toBe(true);
  });

  it('GET/HEAD/OPTIONS/그 외는 false', () => {
    expect(isStateChangingMethod('GET')).toBe(false);
    expect(isStateChangingMethod('HEAD')).toBe(false);
    expect(isStateChangingMethod('OPTIONS')).toBe(false);
    expect(isStateChangingMethod('TRACE')).toBe(false);
  });
});

describe('assertAllowedOrigin', () => {
  it('GET/HEAD/OPTIONS는 Origin 검증 스킵 (CSRF 비대상)', () => {
    expect(() => assertAllowedOrigin(req('GET', { origin: 'https://evil.com' }))).not.toThrow();
    expect(() => assertAllowedOrigin(req('HEAD', { origin: 'https://evil.com' }))).not.toThrow();
    expect(() => assertAllowedOrigin(req('OPTIONS', { origin: 'https://evil.com' }))).not.toThrow();
  });

  it('state-changing + Origin 부재는 통과 (SameSite=Lax 결합)', () => {
    expect(() => assertAllowedOrigin(req('POST'))).not.toThrow();
    expect(() => assertAllowedOrigin(req('PUT', { origin: '' }))).not.toThrow();
  });

  it('state-changing + 허용 Origin은 통과', () => {
    expect(() =>
      assertAllowedOrigin(req('POST', { origin: 'https://candidate.example.com' })),
    ).not.toThrow();
  });

  it('state-changing + 미허용 Origin은 AppError SYS_FORBIDDEN_ORIGIN throw', () => {
    expect(() => assertAllowedOrigin(req('POST', { origin: 'https://evil.example.com' }))).toThrow(
      expect.objectContaining({ code: 'SYS_FORBIDDEN_ORIGIN', status: 403 }),
    );
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s 메서드는 모두 CSRF 검증 대상',
    (method) => {
      expect(() => assertAllowedOrigin(req(method, { origin: 'https://evil.com' }))).toThrow();
    },
  );
});
