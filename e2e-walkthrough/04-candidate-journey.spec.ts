import { test, expect } from '@playwright/test';
import { CANDIDATE_STATE, PDF_BYTES, readSharedData } from './support/walkthrough';

// 4. 지원자 핵심 여정 — 마이페이지 → 프로필 완성 → 지원서 제출 → 지원 상세.
//    검증된 지원자 storageState 재사용(매 테스트 로그인 불필요).
test.describe('4. 지원자 여정', () => {
  test.use({ storageState: CANDIDATE_STATE });

  test('마이페이지(/me)가 렌더된다', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('heading', { level: 1, name: '내 지원 현황' })).toBeVisible();
  });

  test('프로필(/me/profile) — 연락처·생년월일 입력 후 저장', async ({ page }) => {
    await page.goto('/me/profile');
    await expect(page.getByRole('heading', { level: 1, name: '프로필' })).toBeVisible();

    await page.getByLabel('이름', { exact: true }).fill('지원자 홍길동');
    await page.getByLabel('연락처', { exact: true }).fill('010-1234-5678');
    await page.getByLabel('생년월일', { exact: true }).fill('1995-05-15');
    await page.getByRole('button', { name: '저장', exact: true }).click();

    await expect(page.getByText(/저장되었습니다|저장 완료|저장됨/).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('지원서 작성/제출 — 이력서 첨부 + 동의 + 제출', async ({ page }) => {
    test.setTimeout(90_000);
    const { jobId } = readSharedData();

    await page.goto(`/jobs/${jobId}/apply`);
    await expect(page.getByRole('heading', { level: 1, name: '지원하기' })).toBeVisible();
    // 프로필(이름)을 채웠으므로 프로필 완성 게이트는 떠 있으면 안 된다.
    await expect(page.getByText('프로필을 먼저 완성')).toHaveCount(0);
    // 경력 구분 UI는 제거됨(제출 시 'NEW' 고정) — 별도 입력 불필요.

    // 이력서 첨부 — 파일 input에 PDF 주입 → 업로드 완료 대기(MinIO 필요).
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES });
    await expect(page.getByText(/업로드 완료/).first()).toBeVisible({ timeout: 25_000 });

    // 동의 체크 후 제출(이름+이력서+동의가 모두 충족되어야 버튼 활성화).
    await page.getByRole('checkbox', { name: /동의하며 제출/ }).check();
    await page.getByRole('button', { name: '지원하기' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: '지원이 완료되었습니다' }),
    ).toBeVisible({ timeout: 25_000 });
  });

  test('마이페이지에 제출한 지원 노출 + 상세 진입', async ({ page }) => {
    const { jobTitle } = readSharedData();
    await page.goto('/me');
    // 공고명 링크로 상세 진입(제목에 정규식 특수문자가 있을 수 있어 문자열 substring 매칭 사용).
    const card = page.getByRole('link', { name: jobTitle }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page).toHaveURL(/\/me\/\d+$/);
    await expect(page.getByRole('heading', { level: 2, name: '전형 진행 타임라인' })).toBeVisible();
  });
});
