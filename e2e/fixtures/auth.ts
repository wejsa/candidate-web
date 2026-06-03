import { type Page, expect } from '@playwright/test';

// CANDID-048 Step 2 — E2E 인증 픽스처.
// 로그인/회원가입 *페이지*는 아직 없으므로(API만 존재) UI 대신 signup API로 인증 상태를 만든다.
// page.request로 호출하면 Set-Cookie(access/refresh, HttpOnly)가 page 컨텍스트 쿠키 jar에
// 부착되어 이후 page.goto가 인증 상태로 동작한다(별도 storageState 파일 불필요).

/** 비밀번호 — 10자 이상 + 3-of-4 문자군(대/소/숫자/특수) 충족(lib/auth/validation). */
export const E2E_PASSWORD = 'E2eTest1234!';

/** 실행마다 고유 이메일 — dev DB의 UNIQUE(email) 충돌/테스트 간 간섭 방지. */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}+${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

/**
 * signup API로 신규 계정을 만들고 page를 인증 상태로 만든다.
 * @returns 생성된 계정 email
 */
export async function signupViaApi(page: Page, email = uniqueEmail()): Promise<{ email: string }> {
  const res = await page.request.post('/api/v1/auth/signup', {
    data: {
      email,
      password: E2E_PASSWORD,
      passwordConfirm: E2E_PASSWORD,
      name: 'E2E 사용자',
      termsAgreed: true,
      privacyAgreed: true,
      ageConfirmed: true,
    },
  });
  // 실패 시 본문을 메시지에 실어 디버깅 용이.
  expect(res.status(), `signup 실패: ${await res.text()}`).toBe(201);
  return { email };
}
