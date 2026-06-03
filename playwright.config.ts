import { defineConfig, devices } from '@playwright/test';

// CANDID-048 Step 1 — Playwright E2E 설정.
// webServer가 `pnpm dev`로 앱을 띄우고 /api/health(CANDID-027, 의존성 無 → DB 없이도 200)로 준비를 판단한다.
// E2E 실행 전제: PostgreSQL/MinIO 기동(docker compose up -d db minio) — DB 의존 시나리오용.
//   브라우저 바이너리: `pnpm exec playwright install chromium` (최초 1회).
// vitest(tests/**)와 분리: 본 스위트는 e2e/ 디렉토리.

const PORT = 3000;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // E2E는 상태(앱+DB)를 공유하므로 기본 직렬 — 데이터 픽스처 간섭 방지(Step 2 시드/인증).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // 이미 떠 있는 서버가 있으면 재사용(로컬). CI에서는 항상 새로 띄운다.
  webServer: {
    command: 'pnpm dev',
    url: `${BASE_URL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
