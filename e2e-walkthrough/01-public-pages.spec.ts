import { test, expect } from '@playwright/test';
import { readSharedData } from './support/walkthrough';

// 1. 공개 페이지 (비인증) — 누구나 볼 수 있는 랜딩/공고 탐색 흐름.
test.describe('1. 공개 페이지', () => {
  test('홈(/) 랜딩이 렌더된다', async ({ page }) => {
    await page.goto('/');
    // 히어로 h1 (P1-1 랜딩 — 채용 브랜드 카피).
    await expect(
      page.getByRole('heading', { level: 1, name: '함께 금융을 움직일 엔지니어를 찾습니다' }),
    ).toBeVisible();
  });

  test('공고 목록(/jobs) — 필터 + 시드 공고 카드 노출', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByRole('heading', { level: 1, name: '채용 공고' })).toBeVisible();
    await expect(page.getByRole('region', { name: '공고 필터' })).toBeVisible();
    // setup이 OPEN 공고 1건을 만들었으므로 카드와 건수 표시가 보인다.
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/총 \d+건/)).toBeVisible();
  });

  test('공고 상세(/jobs/[id]) — 제목 + 비인증 CTA(로그인하고 지원하기)', async ({ page }) => {
    const { jobId, jobTitle } = readSharedData();
    await page.goto(`/jobs/${jobId}`);
    await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}$`));
    await expect(page.getByRole('heading', { level: 1, name: jobTitle })).toBeVisible();
    // 비인증 사용자는 지원 대신 로그인 유도 CTA가 보인다.
    await expect(page.getByRole('button', { name: '로그인하고 지원하기' })).toBeVisible();
  });
});
