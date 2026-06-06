import { defineConfig, devices } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Walkthrough E2E 설정 — "브라우저를 보면서" 도는 관람용 스위트(기존 playwright.config.ts와 독립).
//
//  • 기본 헤디드(headless=false): 실제 Chromium 창이 뜨고 동작이 보인다. WSLg(DISPLAY=:0) 필요.
//      → CI/무창 환경은 E2E_HEADLESS=1 로 헤드리스 전환.
//  • slowMo: 헤디드일 때 각 동작을 천천히 — 눈으로 따라가기 좋게.
//  • setup 프로젝트가 시드(운영자/공고/검증 지원자)를 만든 뒤 chromium 프로젝트가 실행된다.
//  • 전제: PostgreSQL + MinIO 기동(docker compose up -d db minio minio-init), .env 구성.
//      브라우저 바이너리: pnpm exec playwright install chromium (최초 1회).
// 실행:  pnpm test:e2e:walk          (헤디드 — 브라우저 창)
//        pnpm test:e2e:walk:ui       (Playwright UI 모드)
// ─────────────────────────────────────────────────────────────────────────────

const PORT = 3000;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const HEADLESS = process.env.E2E_HEADLESS === '1';

export default defineConfig({
  testDir: './e2e-walkthrough',
  // 앱+DB 상태를 공유하고, "관람" 목적상 순서대로 한 창에서 보는 게 자연스러우므로 직렬 실행.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-walk' }],
  ],
  outputDir: 'test-results-walk',
  use: {
    baseURL: BASE_URL,
    headless: HEADLESS,
    // 헤디드일 때만 동작을 늦춰 눈으로 따라가기 좋게(헤드리스는 0 — 빠르게).
    launchOptions: { slowMo: HEADLESS ? 0 : 600 },
    viewport: { width: 1280, height: 900 },
    video: 'on',
    trace: 'on',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /walkthrough\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'pnpm dev',
    // /api/ready는 DB 연결 성공 시에만 200 → 앱+DB가 모두 준비된 뒤 시작(결정성).
    url: `${BASE_URL}/api/ready`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
