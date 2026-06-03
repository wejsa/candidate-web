import { test, expect, request as apiRequest } from '@playwright/test';
import { signupViaApi } from './fixtures/auth';

// CANDID-048 Step 2 — 핵심 사용자 여정 E2E.
// 인증 가드는 보호 API 401로 검증한다(페이지 redirect는 dev 서버 RSC 렌더 캐싱과 상호작용해
// 플레이키 → API 라우트는 캐싱 무관·결정적). 인증 성공은 보호 API 200 + 인증 상태 /me 페이지로 검증.
// 비인증 검증은 매번 새 클린 APIRequestContext(request.newContext)로 쿠키 간섭을 배제.

test.describe('인증 라운드트립 / 가드', () => {
  test('비인증 보호 API(/api/v1/users/me) → 401 AUTH_*', async ({ baseURL }) => {
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get('/api/v1/users/me');
      expect(res.status()).toBe(401);
      expect((await res.json()).code).toMatch(/^AUTH_/);
    } finally {
      await ctx.dispose();
    }
  });

  test('비인증 지원서 제출(POST /api/v1/applications) → 401', async ({ baseURL }) => {
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      // requireAuth가 body/헤더 파싱 전에 선행 → 미인증은 항상 401.
      const res = await ctx.post('/api/v1/applications', { data: { jobPostingId: 1 } });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('회원가입(API) → 보호 API 200 + 인증 상태로 /me 페이지 접근', async ({ page }) => {
    await signupViaApi(page); // page.request 쿠키가 page 컨텍스트에 부착 → 인증 상태
    // 1) 보호 API가 인증을 인식(round-trip 검증, 캐싱 무관)
    const me = await page.request.get('/api/v1/users/me');
    expect(me.status()).toBe(200);
    // 2) 인증 상태로 /me 페이지 렌더(리다이렉트되지 않음). /me 페이지는 본 스위트에서 인증 상태로만 진입.
    await page.goto('/me');
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole('heading', { level: 1, name: '마이페이지' })).toBeVisible();
  });
});

test.describe('공고 탐색', () => {
  test('/jobs 목록 → 공고 카드 노출 + 상세 진입', async ({ page, request }) => {
    const res = await request.get('/api/v1/jobs');
    expect(res.status(), `jobs API 비정상: ${(await res.text()).slice(0, 200)}`).toBe(200);
    const body = await res.json();
    // 정상 200 응답에서의 빈 목록만 "시드 없음"으로 스킵 — API 실패는 위에서 fail.
    test.skip(!body.items?.length, '공고 시드 없음 — 탐색 여정 스킵');

    const first = body.items[0];
    await page.goto('/jobs');
    // 목록에 첫 공고 제목 링크가 보인다(CANDID-049 수정으로 데이터 존재 시 정상 렌더).
    await expect(page.getByRole('link', { name: first.title }).first()).toBeVisible();

    // 상세 진입 — h1이 해당 공고 제목인지까지 확인(잘못된 페이지 렌더 탐지).
    await page.goto(`/jobs/${first.id}`);
    await expect(page).toHaveURL(new RegExp(`/jobs/${first.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible();
  });
});
