import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { applySecurityHeaders, buildSecurityHeaders } from '@/lib/security/headers';

// 각 케이스는 env 캐시를 초기화하여 NODE_ENV 분기를 매번 다시 평가한다.
beforeEach(() => {
  __resetCachedEnvForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
});

describe('buildSecurityHeaders — dev/test 환경', () => {
  it('포함해야 할 정적 헤더 6종을 모두 가진다', () => {
    const h = buildSecurityHeaders();
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['X-DNS-Prefetch-Control']).toBe('off');
    expect(h['Permissions-Policy']).toContain('geolocation=()');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['Permissions-Policy']).toContain('microphone=()');
    expect(h['Permissions-Policy']).toContain('payment=()');
  });

  it('dev/test CSP는 HMR을 위해 unsafe-inline/unsafe-eval과 ws:를 허용한다', () => {
    const csp = buildSecurityHeaders()['Content-Security-Policy']!;
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain('ws:');
    expect(csp).toContain('wss:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('CSP 공통 directives: default-src/frame-ancestors/object-src/form-action 강제', () => {
    const csp = buildSecurityHeaders()['Content-Security-Policy']!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('HSTS는 dev/test에서 부착하지 않는다 (dev http 영구 캐시 방지)', () => {
    expect(buildSecurityHeaders()['Strict-Transport-Security']).toBeUndefined();
  });

  it('반환 객체는 동결되어 호출측이 mutate할 수 없다', () => {
    const h = buildSecurityHeaders();
    expect(() => {
      (h as Record<string, string>)['X-Frame-Options'] = 'ALLOW';
    }).toThrow();
  });
});

describe('buildSecurityHeaders — production 환경', () => {
  beforeEach(() => {
    // 상위 beforeEach가 NODE_ENV='test' 상태에서 캐시를 초기화한 뒤 stub만 실행한다.
    // 초기화된 캐시는 다음 getEnv() 호출 시 새 NODE_ENV='production'으로 재파싱된다.
    // production 상태에서 __resetCachedEnvForTesting을 호출하면 운영 안전 가드가 throw.
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('HSTS는 production에서만 부착되고 preload + 2년 max-age', () => {
    const hsts = buildSecurityHeaders()['Strict-Transport-Security']!;
    expect(hsts).toContain('max-age=63072000');
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).toContain('preload');
  });

  it('production CSP는 strict — unsafe-eval 제거, upgrade-insecure-requests 포함', () => {
    const csp = buildSecurityHeaders()['Content-Security-Policy']!;
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('ws:');
  });
});

describe('applySecurityHeaders', () => {
  it('NextResponse에 모든 보안 헤더를 in-place로 부착하고 동일 객체를 반환한다', () => {
    const response = new NextResponse(null, { status: 200 });
    const result = applySecurityHeaders(response);
    expect(result).toBe(response);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).not.toBeNull();
  });

  it('이미 부착된 헤더를 덮어쓴다 (멱등성)', () => {
    const response = new NextResponse(null, { status: 200 });
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
    applySecurityHeaders(response);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
