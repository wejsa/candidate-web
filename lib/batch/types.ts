import type { PrismaClient } from '@prisma/client';

// CANDID-029 Step 1 — 야간 정리 배치 공통 타입.
//
// 설계 메모(중요): 본 모듈군(lib/batch/*)은 `'server-only'`를 import하지 않는다.
//   야간 배치는 `tsx scripts/batch/nightly-cleanup.ts`(Node CLI)로 실행되며,
//   'server-only'(Next.js RSC client-bundle 가드)는 CLI 컨텍스트에서 throw한다(prisma/seed.ts 선례).
//   그 대신 PrismaClient를 **주입**받아(lib/prisma의 server-only singleton을 import하지 않음)
//   CLI/테스트 양쪽에서 동일 로직을 실행한다.

/** 배치 정리 함수에 주입되는 Prisma 클라이언트. */
export type BatchDb = PrismaClient;

/** 단일 정리 태스크 실행 결과. */
export interface CleanupTaskResult {
  /** 태스크 식별자(로깅/집계용). */
  name: string;
  /** 삭제된 행 수. 실패 시 0. */
  deleted: number;
  /** 실행 소요 시간(ms). */
  durationMs: number;
  /** 실패 시 PII-free 에러 식별자(name[(code)]). 성공 시 null. */
  error: string | null;
}

/** 야간 배치 전체 실행 결과 — 태스크별 결과 집계. */
export interface BatchRunResult {
  tasks: CleanupTaskResult[];
  /** 전체 삭제 행 수. */
  totalDeleted: number;
  /** 하나 이상의 태스크가 실패했는가(exit code 결정). */
  hasError: boolean;
  /** 전체 소요 시간(ms). */
  durationMs: number;
}

/** 러너가 순차 실행하는 단위 정리 태스크. run은 삭제된 행 수를 반환. */
export interface CleanupTask {
  name: string;
  run: (db: BatchDb, now: Date) => Promise<number>;
}
