import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCachedEnvForTesting, getEnv } from '@/lib/env';

// CANDID-009 Step 2 (H008/H009 보강) — env transform/refine 단독 검증.
// FORCE_HTTPS_REDIRECT / TRUST_PROXY 의 엄격 boolean 파싱 + CORS_ALLOWED_ORIGINS refine.

beforeEach(() => {
  __resetCachedEnvForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
});

describe('FORCE_HTTPS_REDIRECT transform (H008)', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['TRUE', false], // 대소문자 — 엄격
    ['True', false],
    ['yes', false],
    ['0', false],
    ['false', false],
    ['', false],
  ])('FORCE_HTTPS_REDIRECT=%s → %s', (input, expected) => {
    vi.stubEnv('FORCE_HTTPS_REDIRECT', input);
    expect(getEnv().FORCE_HTTPS_REDIRECT).toBe(expected);
  });

  it('미설정(undefined) → false', () => {
    expect(getEnv().FORCE_HTTPS_REDIRECT).toBe(false);
  });
});

describe('TRUST_PROXY transform (H001 보강)', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['TRUE', false],
    ['yes', false],
    ['0', false],
    ['', false],
  ])('TRUST_PROXY=%s → %s', (input, expected) => {
    vi.stubEnv('TRUST_PROXY', input);
    expect(getEnv().TRUST_PROXY).toBe(expected);
  });
});

describe('CORS_ALLOWED_ORIGINS refine (H005 + H009 — BR-SEC-03)', () => {
  it('빈 값은 허용 (NEXT_PUBLIC_APP_URL이 자동 fallback)', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    expect(() => getEnv()).not.toThrow();
  });

  it('유효한 http(s) URL 단일 통과', () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://staging.example.com');
    expect(() => getEnv()).not.toThrow();
  });

  it('유효한 URL 다중(CSV) 통과', () => {
    vi.stubEnv(
      'CORS_ALLOWED_ORIGINS',
      'https://staging.example.com, https://preview.example.com',
    );
    expect(() => getEnv()).not.toThrow();
  });

  it.each([
    ['*', '단일 wildcard'],
    ['https://ok.com,*', 'CSV 내 wildcard'],
    ['https://*.example.com', '서브도메인 wildcard 시도'],
    ['null', 'null origin'],
    ['not-a-url', '잘못된 URL'],
    ['htttps://typo.com', '프로토콜 오타'],
    ['ftp://example.com', 'http(s) 외 프로토콜'],
    ['  https://valid.com  ,*', '혼합 (정상 + wildcard)'],
  ])('거부: %s (%s)', (input) => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', input);
    expect(() => getEnv()).toThrow(/CORS_ALLOWED_ORIGINS/);
  });
});
