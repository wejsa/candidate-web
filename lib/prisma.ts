import 'server-only';
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Query log은 명시적 opt-in (PRISMA_LOG_QUERY=1)으로만 활성화.
// PII 컬럼(CANDID-008+)이 도입되면 query 로그에 평문 PII 노출 위험 — 본 sleeper bug
// 차단을 위해 기본은 warn/error만. 디버깅이 필요하면 단발성으로 PRISMA_LOG_QUERY=1 사용.
const enableQueryLog = process.env.PRISMA_LOG_QUERY === '1';

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: enableQueryLog ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
