import path from 'node:path';
import { defineConfig } from 'vitest/config';

// CANDID-035 (CANDID-005 FU2) Step 1 — 통합 테스트 분리 runner.
// 실제 PostgreSQL DB(docker-compose `db`) + Prisma + piiExtension 회귀 차단용.
//
// 단위 테스트(`pnpm test`)와 분리되어 있어 CI 환경/로컬에서 선택 실행 가능하다.
// 실행 전 `pnpm db:up` (postgres:16-alpine 기동) 필수. globalSetup이 `prisma migrate
// deploy --schema=test_integration`을 1회 실행해 dev schema와 비파괴 공존한다.

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // schema 공유로 병렬 워커 간 데이터 충돌 위험 → 단일 fork 강제 (격리는 TRUNCATE로).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // 단위 테스트 coverage와 분리. 본 runner는 회귀 차단 전용이라 coverage는 미수집.
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // `server-only`는 Next.js 런타임 가드. Node 테스트 환경에서는 비활성화.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
