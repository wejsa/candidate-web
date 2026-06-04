import { defineConfig, devices } from '@playwright/test';

// CANDID-051 Step 1 — Production-build E2E 설정 (soft-404 실측 전용).
//
// 왜 별도 config인가:
//   기본 playwright.config.ts는 `pnpm dev`로 앱을 띄운다. 그러나 Next.js 14의 `notFound()`는
//   dev 모드에서 HTTP 200(soft-404)을, production 빌드에서 404를 반환하는 알려진 차이가 있다.
//   따라서 soft-404의 "실결함 여부"는 반드시 `pnpm build && pnpm start`(production 서버)로만 확정된다.
//
// 실행: `pnpm test:e2e:prod` (헤디드는 `pnpm test:e2e:prod:headed`).
//   전제: PostgreSQL/MinIO 기동(docker compose up -d db minio) + DATABASE_URL, chromium 설치.
//   ⚠️ 리소스 제한 환경에서는 `next build`가 OOM-kill(exit 144) 될 수 있다 — 그 경우 CI/로컬에서 실행한다.

const PORT = Number(process.env.E2E_PROD_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e/prod',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-prod' }]],
  outputDir: 'test-results-prod',
  use: {
    baseURL: BASE_URL,
    // 사용자 선호: 브라우저 가시화. E2E_HEADED=1로 headed 실행(`test:e2e:prod:headed`).
    headless: !process.env.E2E_HEADED,
    video: process.env.CI ? 'retain-on-failure' : 'on',
    trace: process.env.CI ? 'on-first-retry' : 'on',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // production 서버: 빌드 후 start. dev와 달리 status 결정이 prod 런타임과 동일.
    command: `pnpm build && pnpm start -p ${PORT}`,
    // readiness는 DB 불요 라우트(/robots.txt)로 판단한다 — 핵심 repro(/jobs/{비숫자id})는 notFound()가
    // 서비스 조회 *이전*에 호출되어 DB가 없어도 재현된다. DB 의존 케이스는 spec 내 런타임 probe로 skip.
    // (DB까지 필요하면 docker compose up -d db minio + DATABASE_URL 후 실행.)
    url: `${BASE_URL}/robots.txt`,
    // 빌드 시간 포함 — 기본 dev(120s)보다 길게 잡는다.
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
