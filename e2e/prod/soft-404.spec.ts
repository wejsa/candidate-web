import { test, expect, request as apiRequest } from '@playwright/test';
import { signupViaApi } from '../fixtures/auth';

// CANDID-051 Step 1 — production-build soft-404 회귀 가드(실측).
//
// 측정 결과(2026-06-04, next start v14.2.35, NODE_ENV=production):
//   /jobs/abc(비숫자 id → notFound())      -> HTTP 200  ⚠️ soft-404 (확정된 prod 결함)
//   /totally-bogus-route(미정의 라우트)     -> HTTP 404  ✅ (root not-found는 정상)
//   → "dev에서만 200" 가설은 **반증**됐다. 페이지 RSC의 notFound()가 production에서도 200을 반환한다
//     (force-dynamic + streaming 상호작용). dev 전용 아티팩트가 아니라 실제 SEO 결함.
//
// 본 스위트의 역할:
//   - notFound() 경로가 404를 반환해야 함을 *고정*한다(회귀 가드).
//   - 결함이 살아있는 현재(Step 1)는 page-notFound 케이스를 test.fail()로 마킹 → 스위트는 green,
//     동시에 "아직 200"임을 문서화한다. Step 2가 결함을 고치면 test.fail()을 제거해 진짜 가드로 전환한다.
//
// 측정 규약(memory): 진짜 status를 읽으려면 redirect 미추적(maxRedirects:0). apply는 비로그인 시
//   /login redirect가 notFound()보다 선행 → 반드시 인증 컨텍스트로 측정.

const MISSING_JOB_ID = 999999; // dev 시드 범위를 넘는 미존재 공고 id (DB 필요)

// DB 의존 케이스 게이트 — API 대조군이 404를 주면 DB 연결됨. 500/예외면 DB 부재로 보고 skip.
let dbReady = false;
test.beforeAll(async ({ baseURL }) => {
  const ctx = await apiRequest.newContext({ baseURL });
  try {
    const res = await ctx.get(`/api/v1/job-postings/${MISSING_JOB_ID}`, { maxRedirects: 0 });
    dbReady = res.status() === 404;
  } catch {
    dbReady = false;
  } finally {
    await ctx.dispose();
  }
});

test.describe('CANDID-051 — production soft-404 실측', () => {
  test('대조군(DB 불요): 미정의 라우트는 404', async ({ baseURL }) => {
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get('/totally-bogus-route', { maxRedirects: 0 });
      expect(res.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });

  test('결함 repro(DB 불요): 비숫자 id /jobs/abc → notFound() 는 404여야 한다', async ({
    baseURL,
  }) => {
    // ⚠️ 현재 production은 200(soft-404)을 반환한다 → 결함이 고쳐지기 전까지 expected-fail.
    // Step 2에서 결함 수정 후 이 마킹을 제거하면 진짜 회귀 가드가 된다.
    test.fail();
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get('/jobs/abc', { maxRedirects: 0 });
      expect(res.status(), 'page notFound()는 404를 반환해야 한다(soft-404 회귀)').toBe(404);
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

  test('결함 repro(DB 필요): 미존재 공고 상세 /jobs/{id} → 404여야 한다', async ({ baseURL }) => {
    test.skip(!dbReady, 'DB 미연결');
    test.fail(); // 현재 soft-404(200) — Step 2 수정 후 마킹 제거.
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get(`/jobs/${MISSING_JOB_ID}`, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });

  test('결함 repro(DB 필요): 인증 사용자 + 미존재 공고 /jobs/{id}/apply → 404여야 한다', async ({
    page,
  }) => {
    test.skip(!dbReady, 'DB 미연결');
    test.fail(); // 현재 soft-404(200) — Step 2 수정 후 마킹 제거.
    // 인증 후에야 apply가 notFound() 경로에 도달한다(비로그인은 /login redirect).
    await signupViaApi(page);
    const res = await page.request.get(`/jobs/${MISSING_JOB_ID}/apply`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});
