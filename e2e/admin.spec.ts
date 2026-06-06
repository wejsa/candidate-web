import { test, expect, request as apiRequest } from '@playwright/test';
import { signupViaApi } from './fixtures/auth';
import { operatorViaApi, grantRole } from './fixtures/admin';

// CANDID-053 Step 13 — 백오피스 RBAC E2E (권한 차단 + 운영자 흐름).
//
// 인가 가드는 보호 API status로 검증한다(journeys.spec 정합 — 페이지 redirect는 dev RSC 렌더 캐싱과
// 상호작용해 플레이키). 운영자 페이지 접근은 대시보드 콘텐츠로 검증.
// 전제: docker compose up -d db minio + DATABASE_URL. 운영자 승격은 grant-role CLI(fixtures/admin).
//
// RBAC A안: 인가 SSOT = DB users.role 재조회. self-signup=CANDIDATE, 운영자는 CLI로만 발급.
// 비운영자에게 백오피스는 404로 비노출(403 아님 — 정보 은닉).
//
// signup rate-limit(5/시간/IP) 누적 회피를 위해 signup 호출을 최소화(테스트당 1회 이하)한다.

const ADMIN_API = '/api/admin/v1/job-postings/1/applications'; // 운영자 전용 GET(인가가 데이터 접근보다 선행)

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

  test('CANDIDATE → 운영 API 403 + /admin 백오피스 비노출(404)', async ({ page }) => {
    await signupViaApi(page); // 기본 role=CANDIDATE (signup 1회)

    const res = await page.request.get(ADMIN_API);
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('AUTH_FORBIDDEN');

    await page.goto('/admin');
    // 운영자 전용 마커(대시보드 heading / 셸 brand "백오피스") 부재 = 비노출.
    await expect(page.getByRole('heading', { name: '운영 대시보드' })).toHaveCount(0);
    await expect(page.getByText('백오피스', { exact: true })).toHaveCount(0);
    // notFound 양성 신호(Next 기본 404) — "비어서 통과"가 아닌 "의도된 404"임을 강화.
    await expect(page.getByText(/page could not be found/i)).toBeVisible();
  });
});

test.describe('RBAC 즉시 반영 (DB role 재조회 SSOT)', () => {
  test('동일 토큰 — 승격→통과, 강등→403(토큰 재발급 없이 즉시 반영, escalation 차단)', async ({
    page,
  }) => {
    const { email } = await signupViaApi(page); // CANDIDATE (signup 1회)

    // 승격 전 — 거부.
    expect((await page.request.get(ADMIN_API)).status()).toBe(403);

    // 승격 — 같은 page/토큰으로 즉시 통과(DB role 재조회).
    await grantRole(email, 'RECRUITER');
    expect([401, 403]).not.toContain((await page.request.get(ADMIN_API)).status());

    // 강등 — 토큰 그대로인데 즉시 403(권한 캐싱/토큰 클레임 신뢰 회귀 차단).
    await grantRole(email, 'CANDIDATE');
    const after = await page.request.get(ADMIN_API);
    expect(after.status()).toBe(403);
    expect((await after.json()).code).toBe('AUTH_FORBIDDEN');
  });
});

test.describe('운영자 흐름 (RECRUITER)', () => {
  test('/admin 대시보드 + 공고 관리 화면 접근 + 운영 API 인가 통과', async ({ page }) => {
    await operatorViaApi(page, 'RECRUITER'); // signup 1회 + 승격

    // 운영 API 인가 통과 — 거부(401/403) 아님 + 양성 화이트리스트(공고 1 존재/부재 모두 정상).
    expect([200, 404]).toContain((await page.request.get(ADMIN_API)).status());

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '운영 대시보드' })).toBeVisible();
    await expect(page.getByText('백오피스', { exact: true })).toBeVisible(); // 셸 brand

    await page.goto('/admin/job-postings');
    await expect(page.getByRole('heading', { name: '공고 관리' })).toBeVisible();
    await expect(page.getByRole('link', { name: /새 공고/ })).toBeVisible();
  });
});
