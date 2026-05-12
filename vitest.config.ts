import path from 'node:path';
import { defineConfig } from 'vitest/config';

// CANDID-008 도입 — 단위 테스트 프레임워크.
// 테스트 실행: `pnpm test` (run-once) / `pnpm test:watch` (watch) / `pnpm test:coverage` (커버리지).

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
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
