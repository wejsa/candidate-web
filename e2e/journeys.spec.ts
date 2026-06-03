import { test, expect } from '@playwright/test';
import { signupViaApi } from './fixtures/auth';

// CANDID-048 Step 2 — 핵심 사용자 여정 E2E.
// 인증은 signup API로 수립(로그인/회원가입 페이지 미존재). 데이터 의존 여정은 /api/v1/jobs로
// 시드 존재를 확인 후 진행(없으면 skip — dev-bootstrap 미적용 환경 내성).
// 각 test는 새 브라우저 컨텍스트(쿠키 격리) — workers:1 직렬.

test.describe('인증 가드 / 여정', () => {
  test('회원가입(API) 후 인증 상태로 /me 접근', async ({ page }) => {
    await signupViaApi(page);
    await page.goto('/me');
    // 인증되면 /login으로 리다이렉트되지 않고 /me 유지.
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole('heading', { level: 1, name: '마이페이지' })).toBeVisible();
  });

  // 인증 가드는 브라우저 내비게이션으로 검증한다(Next redirect()는 브라우저 navigate엔 307을
  // 주지만 raw API GET엔 200/RSC를 반환 → 페이지 내비게이션이 정확). default page/request 픽스처는
  // 같은 워커의 signup 쿠키가 누수될 수 있어, 명시적으로 새 클린 컨텍스트(browser.newContext)를 쓴다.
  test('비인증 /me → /login?redirect 리다이렉트(인증 가드)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    try {
      await page.goto('/me');
      await expect(page).toHaveURL(/\/login\?redirect=%2Fme/);
    } finally {
      await ctx.close();
    }
  });

  test('비인증 지원 페이지(/jobs/:id/apply) → /login?redirect 리다이렉트', async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    try {
      const body = await (await page.request.get('/api/v1/jobs')).json();
      const jobId = body.items?.[0]?.id;
      test.skip(jobId == null, '공고 시드 없음 — 지원 리다이렉트 여정 스킵');
      await page.goto(`/jobs/${jobId}/apply`);
      await expect(page).toHaveURL(/\/login\?redirect=/);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('공고 탐색', () => {
  test('/jobs 목록 → 공고 카드 노출 + 상세 진입', async ({ page, request }) => {
    const body = await (await request.get('/api/v1/jobs')).json();
    test.skip(!body.items?.length, '공고 시드 없음 — 탐색 여정 스킵');

    const first = body.items[0];
    await page.goto('/jobs');
    // 목록에 첫 공고 제목 링크가 보인다(CANDID-049 수정으로 데이터 존재 시 정상 렌더).
    await expect(page.getByRole('link', { name: first.title }).first()).toBeVisible();

    // 상세 페이지 진입.
    await page.goto(`/jobs/${first.id}`);
    await expect(page).toHaveURL(new RegExp(`/jobs/${first.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
