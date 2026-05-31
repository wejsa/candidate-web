// CANDID-025 Step 2 — app/robots.ts 단위 테스트.
// route default export를 직접 import하여 호출 (tests/app/api/v1/jobs/route.test.ts 패턴).
// baseUrl은 모듈 스코프 상수(import 시 1회 평가) → env 케이스마다 resetModules + dynamic import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('robots', () => {
  it('allows / and disallows 개인 데이터/API/비밀번호 경로 + sitemap·host 매핑', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com');
    const { default: robots } = await import('@/app/robots');

    const result = robots();

    expect(result.rules).toMatchObject({
      userAgent: '*',
      allow: '/',
      disallow: ['/me', '/api', '/password'],
    });
    expect(result.sitemap).toBe('https://candidate.example.com/sitemap.xml');
    expect(result.host).toBe('https://candidate.example.com');
  });

  it('strips trailing slashes from NEXT_PUBLIC_APP_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://candidate.example.com//');
    const { default: robots } = await import('@/app/robots');
    expect(robots().sitemap).toBe('https://candidate.example.com/sitemap.xml');
  });
});
