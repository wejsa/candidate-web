import path from 'node:path';
import { defineConfig } from 'vitest/config';

// CANDID-008 도입 — 단위 테스트 프레임워크.
// 테스트 실행: `pnpm test` (run-once) / `pnpm test:watch` (watch) / `pnpm test:coverage` (커버리지).

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // CANDID-035 Step 1: 통합 테스트는 별도 runner(`vitest.config.integration.ts`)에서 실행.
    exclude: ['tests/integration/**', 'node_modules/**', 'dist/**', '.next/**'],
    setupFiles: ['tests/setup.ts'],
    // CANDID-015 Step 4: client hook 단위 테스트만 jsdom 환경 (window/timer/event 필요).
    // 다른 테스트는 node 환경 유지. RSC 컴포넌트 테스트 인프라는 F-5 carry (FU1 위임).
    environmentMatchGlobs: [['tests/lib/drafts/use-auto-save.test.ts', 'jsdom']],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/env.ts', 'lib/prisma.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // `server-only`는 Next.js 런타임 가드. Node 테스트 환경에서는 비활성화.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
