import 'server-only';
import { PrismaClient } from '@prisma/client';
import { piiExtension } from '@/lib/prisma/extends';
import { getEnv } from '@/lib/env';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Query log은 명시적 opt-in (PRISMA_LOG_QUERY=1)으로만 활성화. (CANDID-064: zod env 단일 진입점 경유)
// CANDID-008 이후 phone/birth_date는 BYTEA(ciphertext)로만 저장되므로 query log에 평문 PII 노출 없음.
// 단, 다른 컬럼(email/name)은 평문이므로 운영에서 query log는 여전히 비권장.
const enableQueryLog = getEnv().PRISMA_LOG_QUERY;

const basePrisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: enableQueryLog ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = basePrisma;
}

// CANDID-008: $extends된 wrapper export — 호출자는 자동 PII 복호화된 결과를 받음.
// 쓰기 시에는 lib/prisma/extends.ts의 encryptUserPiiInput 헬퍼 사용 필수.
export const prisma = basePrisma.$extends(piiExtension);

// 마이그레이션 / seed 스크립트 등 raw client가 필요한 곳에서만 사용.
export { basePrisma };
