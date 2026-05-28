import path from 'node:path';
import { defineConfig } from 'vitest/config';

// CANDID-008 도입 — 단위 테스트 프레임워크.
// 테스트 실행: `pnpm test` (run-once) / `pnpm test:watch` (watch) / `pnpm test:coverage` (커버리지).

export default defineConfig({
  test: {
    environment: 'node',
    // CANDID-016 Step 3: .test.tsx 포함 (RTL-less minimal renderer 패턴).
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // CANDID-035 Step 1: 통합 테스트는 별도 runner(`vitest.config.integration.ts`)에서 실행.
    exclude: ['tests/integration/**', 'node_modules/**', 'dist/**', '.next/**'],
    setupFiles: ['tests/setup.ts'],
    // CANDID-015 Step 4 + CANDID-016 Step 3: 브라우저 환경(XHR/window/event) 필요 테스트만 jsdom.
    // 다른 테스트는 node 환경 유지.
    // T-CRITICAL-1 fix (PR #59 회차 1): ResumeUploadStep.test.tsx dead reference 제거.
    // RTL 컴포넌트 테스트는 follow-up task로 carry — 도입 시 본 배열에 다시 추가.
    environmentMatchGlobs: [
      ['tests/lib/drafts/use-auto-save.test.ts', 'jsdom'],
      ['tests/lib/files/client.test.ts', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.ts'],
      // L-005 (CANDID-008 retro §5.2.4 / CANDID-032 Step 2 대응):
      //   `lib/env.ts`는 부팅 시점 zod refine으로 단위 테스트 커버 불가.
      //   `lib/prisma.ts`는 `server-only` import + Next.js singleton(globalThis.__prisma)이라
      //     단위 테스트 환경에서 운영 인스턴스를 실수로 import할 위험. 단, exclude로 인해
      //     `$extends(piiExtension)` wiring이 100% 통계 뒤에 숨는 부작용 발생 →
      //     **통합 테스트 `prisma-singleton-wiring.test.ts`가 운영 모듈 경로의 wiring을 직접 증명**.
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
