import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeOAuthRedirect, resolveCallbackRedirect } from '@/lib/auth/oauth/redirect';
import { __resetCachedEnvForTesting } from '@/lib/env';

// CANDID-012 Step 3 review fix (C001 + S-MAJOR-4.1/4.2) — redirect sanitize + origin 검증 단위 테스트.

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  __resetCachedEnvForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
});

describe('sanitizeOAuthRedirect', () => {
  it.each([
    ['/', '/'],
    ['/jobs', '/jobs'],
    ['/jobs/1?ref=hero', '/jobs/1?ref=hero'],
  ])('정상 path %s → 그대로 통과', (input, expected) => {
    expect(sanitizeOAuthRedirect(input)).toBe(expected);
  });

  it.each([
    [null, '비-string'],
    [undefined, 'undefined'],
    ['', '빈 문자'],
    ['//evil.com', 'protocol-relative'],
    ['//evil.com/path', 'protocol-relative path'],
    ['http://evil.com', '외부 절대 URL (http)'],
    ['https://evil.com', '외부 절대 URL (https)'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['/\\evil.com', 'backslash 우회'],
    ['no-leading-slash', '슬래시 없음'],
    ['/jobs\t/evil', 'tab 포함'],
    ['/jobs\n/evil', 'LF 포함'],
    ['/jobs\r/evil', 'CR 포함'],
    ['/jobs\x00/evil', 'NUL 포함'],
    ['/jobs\x7F/evil', 'DEL 포함'],
    ['/\t//evil.com', 'tab + protocol-relative (브라우저 URL parsing 우회)'],
  ])('비정상 입력 %s (%s) → "/" fallback', (input, _label) => {
    expect(sanitizeOAuthRedirect(input as string | null | undefined)).toBe('/');
  });

  it('2048자 초과 → "/" fallback', () => {
    const long = '/' + 'a'.repeat(2048);
    expect(sanitizeOAuthRedirect(long)).toBe('/');
  });

  it('2048자 정확 → 통과', () => {
    const exact = '/' + 'a'.repeat(2047); // total 2048
    expect(sanitizeOAuthRedirect(exact)).toBe(exact);
  });
});

describe('resolveCallbackRedirect — defense-in-depth origin 검증', () => {
  it('내부 path → 자사 origin URL', () => {
    const result = resolveCallbackRedirect('/jobs');
    expect(result.origin).toBe('http://localhost:3000');
    expect(result.pathname).toBe('/jobs');
  });

  it('절대 URL이 stateResult.redirect에 주입되어도 origin 검증으로 차단', () => {
    // state cookie 변조는 HMAC으로 막히나, 단위 테스트에서 재sanitize/origin 검증 layer를 직접 확인
    const result = resolveCallbackRedirect('https://evil.com/steal');
    expect(result.origin).toBe('http://localhost:3000');
    expect(result.pathname).toBe('/');
  });

  it('protocol-relative URL → 자사 origin "/" fallback', () => {
    const result = resolveCallbackRedirect('//evil.com');
    expect(result.origin).toBe('http://localhost:3000');
    expect(result.pathname).toBe('/');
  });

  it('tab character 포함 redirect → "/" fallback (브라우저 URL parsing 우회 차단)', () => {
    const result = resolveCallbackRedirect('/\t//evil.com');
    expect(result.origin).toBe('http://localhost:3000');
    expect(result.pathname).toBe('/');
  });

  it('redirect 빈 문자 → 자사 origin "/"', () => {
    const result = resolveCallbackRedirect('');
    expect(result.origin).toBe('http://localhost:3000');
    expect(result.pathname).toBe('/');
  });
});
