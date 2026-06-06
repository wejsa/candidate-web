import { test, expect } from '@playwright/test';
import { PASSWORD, readSharedData } from './support/walkthrough';

// 3. 로그인 페이지 UI — setup이 만든 검증된 지원자 계정으로 로그인 → /me 진입.
test.describe('3. 로그인', () => {
  test('로그인 폼 제출 → /me 진입 + 보호 API 200', async ({ page }) => {
    const { candidateEmail } = readSharedData();

    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible();

    // exact: true — 카드 제목 "이메일로 로그인"과의 substring 충돌 회피.
    await page.getByLabel('이메일', { exact: true }).fill(candidateEmail);
    await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();

    await page.waitForURL(/\/me$/, { timeout: 15_000 });
    const me = await page.request.get('/api/v1/users/me');
    expect(me.status()).toBe(200);
  });
});
