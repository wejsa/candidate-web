import { test, expect, request as apiRequest } from '@playwright/test';
import { signupViaApi } from '../fixtures/auth';

// CANDID-051 — production soft-404 특성 고정 + SEO 미티게이션 회귀 가드.
//
// 조사 결론(2026-06-04, next start v14.2.35, prod 실측):
//   페이지 RSC의 notFound()는 동적 렌더(SSR) 매칭 라우트에서 HTTP **200**(soft-404)을 반환한다.
//   force-dynamic 제거 / loading.tsx 제거 / middleware 완전 제거 모두 무효 → **Next 14 코어 한계**로
//   격리 확인(미정의 라우트만 404). 코드로 404를 강제할 수 없음(docs/requirements/CANDID-051-spec.md §근본원인).
//
// 따라서 본 스위트는 (1) "여전히 200"임을 *특성 테스트*로 고정(상위 Next에서 404로 바뀌면 알림 = 문서 갱신 트리거)
//   하고, (2) 죽은 URL 색인을 막는 *유일한 SEO 방어선*인 robots:noindex가 응답에 존재함을 **회귀 가드**한다.
//
// 측정 규약(memory): 진짜 status는 maxRedirects:0. apply는 비로그인 시 /login redirect 선행 → 인증 컨텍스트.

const MISSING_JOB_ID = 999999; // dev 시드 범위를 넘는 미존재 공고 id (DB 필요)
// Next가 robots:{index:false,follow:false}를 렌더한 <meta name="robots" content="noindex, ...">를 매칭.
const NOINDEX_META = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i;

// DB 의존 케이스 게이트 — API가 status로 응답(404 또는 200)하면 DB 연결됨, 500/예외면 미연결.
let dbReady = false;
test.beforeAll(async ({ baseURL }) => {
  const ctx = await apiRequest.newContext({ baseURL });
  try {
    const res = await ctx.get(`/api/v1/job-postings/${MISSING_JOB_ID}`, { maxRedirects: 0 });
    dbReady = res.status() === 404 || res.status() === 200;
  } catch {
    dbReady = false;
  } finally {
    await ctx.dispose();
  }
});

test.describe('CANDID-051 — production soft-404 특성 + noindex 가드', () => {
  test('대조군(DB 불요): 미정의 라우트는 404', async ({ baseURL }) => {
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get('/totally-bogus-route', { maxRedirects: 0 });
      expect(res.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });

  test('특성 고정(DB 불요): /jobs/{비숫자id} notFound() → 200 (Next 14 한계)', async ({
    baseURL,
  }) => {
    // ⚠️ 이 200은 "결함"이 아니라 *문서화된 프레임워크 한계*다. 상위 Next에서 404로 바뀌면 본 단언이
    //    실패하여 CANDID-051-spec 갱신을 유도한다(limitation tripwire). 회귀 방어는 아래 noindex 가드가 담당.
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get('/jobs/abc', { maxRedirects: 0 });
      expect(res.status(), 'Next 14 SSR notFound()는 200을 반환한다(문서화된 한계)').toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test('🛡️ 미티게이션 가드(DB 불요): /jobs/{비숫자id} not-found 응답에 robots noindex 존재', async ({
    baseURL,
  }) => {
    // soft-404의 죽은 URL 색인을 막는 *유일한* 방어선. 이 가드가 깨지면 검색엔진이 404 페이지를 색인한다.
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get('/jobs/abc', { maxRedirects: 0 });
      const html = await res.text();
      expect(html, 'not-found 응답 <head>에 robots noindex 메타가 있어야 한다').toMatch(
        NOINDEX_META,
      );
    } finally {
      await ctx.dispose();
    }
  });

  test('대조군(DB 필요): 미존재 공고 API는 404 JOB_NOT_FOUND', async ({ baseURL }) => {
    test.skip(!dbReady, 'DB 미연결 — docker compose up -d db + DATABASE_URL 후 실행');
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get(`/api/v1/job-postings/${MISSING_JOB_ID}`, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
      expect((await res.json()).code).toBe('JOB_NOT_FOUND');
    } finally {
      await ctx.dispose();
    }
  });

  test('🛡️ 미티게이션 가드(DB 필요): 미존재 공고 상세 not-found에 robots noindex', async ({
    baseURL,
  }) => {
    test.skip(!dbReady, 'DB 미연결');
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get(`/jobs/${MISSING_JOB_ID}`, { maxRedirects: 0 });
      expect(await res.text()).toMatch(NOINDEX_META);
    } finally {
      await ctx.dispose();
    }
  });

  test('🛡️ 미티게이션 가드(DB 필요): 인증 사용자 지원 페이지에 robots noindex', async ({
    page,
  }) => {
    test.skip(!dbReady, 'DB 미연결');
    // 지원 페이지는 정적 metadata로 *항상* noindex(인증 게이트 폼). 미존재 공고 soft-404 경로도 동일 보장.
    await signupViaApi(page);
    const res = await page.request.get(`/jobs/${MISSING_JOB_ID}/apply`, { maxRedirects: 0 });
    expect(await res.text()).toMatch(NOINDEX_META);
  });
});
