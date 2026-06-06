import { test, expect } from '@playwright/test';
import { RECRUITER_STATE, readSharedData } from './support/walkthrough';

// 5. 운영자 백오피스 — 대시보드 → 공고 관리 → 지원자 목록/상세.
//    RECRUITER storageState 재사용. (지원서 제출은 4번 여정이 선행되어 지원자가 1건 존재.)
test.describe('5. 운영자 백오피스', () => {
  test.use({ storageState: RECRUITER_STATE });

  test('대시보드(/admin) + 공고 관리 목록 진입', async ({ page }) => {
    const { jobTitle } = readSharedData();

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '운영 대시보드' })).toBeVisible();

    await page.goto('/admin/job-postings');
    await expect(page.getByRole('heading', { name: '공고 관리' })).toBeVisible();
    await expect(page.getByRole('link', { name: /새 공고/ })).toBeVisible();
    await expect(page.getByText(jobTitle).first()).toBeVisible();
  });

  test('공고 수정 페이지 — 제목 프리필 확인', async ({ page }) => {
    const { jobId, jobTitle } = readSharedData();
    await page.goto(`/admin/job-postings/${jobId}/edit`);
    await expect(page.getByRole('heading', { name: '공고 수정' })).toBeVisible();
    await expect(page.getByLabel('제목')).toHaveValue(jobTitle);
  });

  test('지원자 목록 + 지원서 상세 진입(PII 열람 감사 안내)', async ({ page }) => {
    test.setTimeout(60_000);
    const { jobId } = readSharedData();

    await page.goto(`/admin/job-postings/${jobId}/applicants`);
    await expect(page.getByRole('heading', { name: '지원자 목록' })).toBeVisible();

    // 4번 여정이 제출한 지원자의 상세로 진입.
    const detail = page.getByRole('link', { name: '상세' }).first();
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await detail.click();

    await expect(page).toHaveURL(/\/admin\/applications\/\d+$/, { timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 2, name: '지원자 정보' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/감사 로그/)).toBeVisible();
  });
});
