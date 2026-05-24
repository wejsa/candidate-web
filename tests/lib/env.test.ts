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

// CANDID-016 Step 1 — S3 4-tuple strong-pair superRefine.
// S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY 4개는 모두 set 또는 모두 unset 두 상태만 허용.
// 부분 설정으로 부팅하면 presign 호출 시 SDK가 5xx로 노출되는 사고를 방지.
describe('S3 tuple superRefine (CANDID-016)', () => {
  it('4개 모두 unset — 통과 (저장소 비활성 모드)', () => {
    // setup.ts에서 delete 처리되어 기본 상태가 모두 unset.
    expect(() => getEnv()).not.toThrow();
  });

  it('4개 모두 set — 통과', () => {
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_BUCKET', 'candidate-web-resumes');
    vi.stubEnv('S3_ACCESS_KEY', 'candidate');
    vi.stubEnv('S3_SECRET_KEY', 'candidate-dev-secret');
    expect(() => getEnv()).not.toThrow();
  });

  it.each([
    ['S3_BUCKET 누락', { S3_ENDPOINT: 'http://localhost:9000', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's' }, /S3_BUCKET.*partial S3 config/],
    ['S3_SECRET_KEY 누락', { S3_ENDPOINT: 'http://localhost:9000', S3_BUCKET: 'b', S3_ACCESS_KEY: 'k' }, /S3_SECRET_KEY.*partial S3 config/],
    ['S3_ENDPOINT만 set', { S3_ENDPOINT: 'http://localhost:9000' }, /partial S3 config/],
    ['S3_BUCKET만 set', { S3_BUCKET: 'b' }, /partial S3 config/],
  ])('부분 설정 → 부팅 차단: %s', (_label, partial, pattern) => {
    for (const [k, v] of Object.entries(partial)) vi.stubEnv(k, v);
    expect(() => getEnv()).toThrow(pattern);
  });
});

// CANDID-016 Step 1 PR #57 in-PR fix (S-MAJOR-1) — S3_ENDPOINT URL 검증 강화.
// 운영 HTTPS 강제 + 사설/메타데이터/loopback IP 차단. dev http는 localhost만 예외.
describe('S3_ENDPOINT URL guard (CANDID-016 S-MAJOR-1 fix)', () => {
  function stubS3Pair(): void {
    vi.stubEnv('S3_BUCKET', 'b');
    vi.stubEnv('S3_ACCESS_KEY', 'k');
    vi.stubEnv('S3_SECRET_KEY', 's');
  }

  it('https + 공인 도메인 통과', () => {
    stubS3Pair();
    vi.stubEnv('S3_ENDPOINT', 'https://s3.ap-northeast-2.amazonaws.com');
    expect(() => getEnv()).not.toThrow();
  });

  it('dev — http://localhost:9000 통과 (NODE_ENV=test)', () => {
    stubS3Pair();
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    expect(() => getEnv()).not.toThrow();
  });

  it('dev — http://127.0.0.1:9000 통과 (NODE_ENV=test)', () => {
    stubS3Pair();
    vi.stubEnv('S3_ENDPOINT', 'http://127.0.0.1:9000');
    expect(() => getEnv()).not.toThrow();
  });

  it.each([
    ['cloud metadata', 'http://169.254.169.254'],
    ['RFC1918 10.x', 'http://10.0.0.1'],
    ['RFC1918 172.20.x', 'http://172.20.0.1'],
    ['RFC1918 192.168.x', 'http://192.168.1.1'],
    ['ftp 프로토콜', 'ftp://example.com'],
    ['dev http + 임의 호스트', 'http://internal-admin:8080'],
  ])('차단: %s — %s', (_label, url) => {
    stubS3Pair();
    vi.stubEnv('S3_ENDPOINT', url);
    expect(() => getEnv()).toThrow(/S3_ENDPOINT/);
  });

  it('https + 사설 IP — HTTPS여도 차단', () => {
    stubS3Pair();
    vi.stubEnv('S3_ENDPOINT', 'https://10.0.0.1');
    expect(() => getEnv()).toThrow(/S3_ENDPOINT/);
  });
});

// CANDID-016 Step 1 — S3_PRESIGN_TTL_SEC 기본/경계.
describe('S3_PRESIGN_TTL_SEC (CANDID-016)', () => {
  it('미설정 시 기본 300', () => {
    expect(getEnv().S3_PRESIGN_TTL_SEC).toBe(300);
  });

  it('유효 범위 안 통과', () => {
    vi.stubEnv('S3_PRESIGN_TTL_SEC', '600');
    expect(getEnv().S3_PRESIGN_TTL_SEC).toBe(600);
  });

  it('900 초과는 부팅 차단 (BR-FILE-05 운영 안전)', () => {
    vi.stubEnv('S3_PRESIGN_TTL_SEC', '901');
    expect(() => getEnv()).toThrow();
  });
});
