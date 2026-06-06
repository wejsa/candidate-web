import { test, expect, request as apiRequest } from '@playwright/test';
import { signupViaApi } from './fixtures/auth';
import { operatorViaApi } from './fixtures/admin';

// CANDID-053 Step 13 — 백오피스 RBAC E2E (권한 차단 + 운영자 흐름).
//
// 인가 가드는 보호 API status로 검증한다(journeys.spec 정합 — 페이지 redirect는 dev RSC 렌더 캐싱과
// 상호작용해 플레이키). 운영자 페이지 접근은 대시보드 콘텐츠로 검증.
// 전제: docker compose up -d db minio + DATABASE_URL. 운영자 승격은 grant-role CLI(operatorViaApi).
//
// RBAC A안: 인가 SSOT = DB users.role 재조회. self-signup=CANDIDATE, 운영자는 CLI로만 발급.
// 비운영자에게 백오피스는 404로 비노출(403 아님 — 정보 은닉).

const ADMIN_API = '/api/admin/v1/job-postings/1/applications'; // 운영자 전용 GET(존재 여부와 무관히 인가 선행)

test.describe('백오피스 접근 제어 (RBAC A안)', () => {
  test('비인증 운영 API → 401 AUTH_*', async ({ baseURL }) => {
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get(ADMIN_API);
      expect(res.status()).toBe(401);
      expect((await res.json()).code).toMatch(/^AUTH_/);
    } finally {
      await ctx.dispose();
    }
  });

  test('CANDIDATE 운영 API → 403 AUTH_FORBIDDEN(인가 거부)', async ({ page }) => {
    await signupViaApi(page); // 기본 role=CANDIDATE
    const res = await page.request.get(ADMIN_API);
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('AUTH_FORBIDDEN');
  });

  test('CANDIDATE /admin 페이지 → 백오피스 비노출(운영 콘텐츠 없음)', async ({ page }) => {
    await signupViaApi(page);
    await page.goto('/admin');
    // notFound로 비노출 — 운영 대시보드/사이드바가 보이면 안 된다(정보 은닉).
    await expect(page.getByRole('heading', { name: '운영 대시보드' })).toHaveCount(0);
    await expect(page.getByText('백오피스')).toHaveCount(0);
  });
});

test.describe('운영자 흐름 (RECRUITER)', () => {
  test('운영 API 인가 통과(403 아님)', async ({ page }) => {
    await operatorViaApi(page, 'RECRUITER');
    const res = await page.request.get(ADMIN_API);
    // 공고 1 존재 여부에 따라 200/404일 수 있으나 인가 거부(401/403)는 아니어야 한다.
    expect([401, 403]).not.toContain(res.status());
  });

  test('/admin 대시보드 + 공고 관리 화면 접근', async ({ page }) => {
    await operatorViaApi(page, 'RECRUITER');

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '운영 대시보드' })).toBeVisible();
    // 셸 사이드바 + 진입 카드.
    await expect(page.getByRole('link', { name: '공고 관리' }).first()).toBeVisible();

    await page.goto('/admin/job-postings');
    await expect(page.getByRole('heading', { name: '공고 관리' })).toBeVisible();
    // 새 공고 진입점.
    await expect(page.getByRole('link', { name: /새 공고/ })).toBeVisible();
  });
});
