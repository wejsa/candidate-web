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

// CANDID-012 Step 1 — OAuth client credential 쌍 무결성 (superRefine).
// 각 provider는 CLIENT_ID/CLIENT_SECRET을 *모두* 채우거나 *모두* 비워야 한다.
// 한쪽만 설정되면 부팅 차단 — start handler가 secret 없이 authorize URL 생성하거나
// callback이 client_id 없이 token exchange를 시도해 런타임 5xx로 노출되는 사고를 방지.
describe('OAuth pair superRefine (CANDID-012)', () => {
  it.each([
    ['google', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    ['github', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'],
  ])('%s — ID만 설정되면 부팅 차단 (SECRET 누락)', (_, idKey, secretKey) => {
    vi.stubEnv(idKey, 'id-only-value');
    vi.stubEnv(secretKey, '');
    expect(() => getEnv()).toThrow(new RegExp(`${secretKey}.*partial OAuth credentials`));
  });

  it.each([
    ['google', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    ['github', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'],
  ])('%s — SECRET만 설정되면 부팅 차단 (ID 누락)', (_, idKey, secretKey) => {
    vi.stubEnv(idKey, '');
    vi.stubEnv(secretKey, 'secret-only-value');
    expect(() => getEnv()).toThrow(new RegExp(`${idKey}.*partial OAuth credentials`));
  });

  it('Google·GitHub 둘 다 채워진 정상 — 통과', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'g-id');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'g-secret');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'gh-id');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'gh-secret');
    expect(() => getEnv()).not.toThrow();
  });

  it('둘 다 비어 있어도 통과 (선택적 provider)', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', '');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', '');
    expect(() => getEnv()).not.toThrow();
  });

  it('한 provider만 활성화 (Google만 채움, GitHub 비움) — 통과', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'g-id');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'g-secret');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', '');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', '');
    expect(() => getEnv()).not.toThrow();
  });
});
