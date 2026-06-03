import { defineConfig, devices } from '@playwright/test';

// CANDID-048 Step 1 — Playwright E2E 설정.
// webServer가 `pnpm dev`로 앱을 띄우고 /api/ready(CANDID-027 — DB 연결까지 확인)로 준비를 판단한다.
//   → DB 미기동 시 health(200)만 보고 시작해 /jobs SSR이 깨지는 플레이키를 방지(PR #123 리뷰 반영).
// E2E 실행 전제: PostgreSQL/MinIO 기동(docker compose up -d db minio) + 컨테이너 매칭 DATABASE_URL.
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
    // 헤드리스 기본. 라이브 브라우저 창은 `pnpm test:e2e:headed`(WSLg/X11 디스플레이 필요).
    headless: !process.env.E2E_HEADED,
    // 브라우저 동작을 "보여주기" — 로컬은 항상 비디오+trace 녹화(HTML 리포트에서 재생),
    // CI는 실패분만(아티팩트 비대화 방지). `pnpm exec playwright show-report`로 열람.
    video: process.env.CI ? 'retain-on-failure' : 'on',
    trace: process.env.CI ? 'on-first-retry' : 'on',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // 이미 떠 있는 서버가 있으면 재사용(로컬). CI에서는 항상 새로 띄운다.
  webServer: {
    command: 'pnpm dev',
    // /api/ready는 DB 연결 성공 시에만 200 → 앱+DB가 모두 준비된 뒤 테스트 시작(결정성).
    url: `${BASE_URL}/api/ready`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
