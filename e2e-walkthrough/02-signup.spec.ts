import { test, expect } from '@playwright/test';
import { PASSWORD, uniqueEmail } from './support/walkthrough';

// 2. 회원가입 페이지 UI — 신규 지원자 가입 → 이메일 인증 안내.
//    (signup rate-limit 5/시간/IP — setup 2회 + 이 1회로 한도 내.)
test.describe('2. 회원가입', () => {
  test('가입 폼 작성 → 제출 → 인증 메일 안내 화면', async ({ page }) => {
    const email = uniqueEmail('walk-signup');

    await page.goto('/signup');
    await expect(page.getByRole('heading', { level: 1, name: '회원가입' })).toBeVisible();

    await page.getByLabel('이메일', { exact: true }).fill(email);
    await page.getByLabel('이름', { exact: true }).fill('Walkthrough 가입');
    await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
    await page.getByLabel('비밀번호 확인', { exact: true }).fill(PASSWORD);
    await page.getByRole('checkbox', { name: /이용약관/ }).check();
    await page.getByRole('checkbox', { name: /개인정보 처리방침/ }).check();
    await page.getByRole('checkbox', { name: /만 14세/ }).check();

    await page.getByRole('button', { name: /가입하기/ }).click();

    await expect(page.getByRole('heading', { name: '가입이 완료되었습니다' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/인증 메일을 보냈습니다/)).toBeVisible();
  });
});
