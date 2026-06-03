import type { BatchDb, BatchRunResult, CleanupTask, CleanupTaskResult } from '@/lib/batch/types';
import {
  cleanupExpiredEmailVerifications,
  cleanupExpiredIdempotencyKeys,
  cleanupExpiredPasswordResetTokens,
} from '@/lib/batch/expired-rows';
import { cleanupStaleDrafts } from '@/lib/batch/draft-retention';
import { deleteBatchObject } from '@/lib/batch/storage';
import { processPendingScans } from '@/lib/batch/virus-scan';
import { getScanner } from '@/lib/files/scanner';
import { notifyInfectedFile } from '@/lib/batch/notify';

// CANDID-029 Step 1 — 야간 정리 배치 러너.
//
// 책임: 등록된 정리 태스크를 순차 실행하되 **태스크별로 격리**한다 — 한 태스크가 throw해도
//   나머지는 계속 실행하고, 결과를 집계해 반환한다(부분 실패 가시성 + exit code 결정).
// 외부 스케줄러는 scripts/batch/nightly-cleanup.ts(tsx)로 본 러너를 호출한다.
//
// 후속 스텝에서 Draft 정리(Step 2)·바이러스 스캔(Step 3) 태스크가 defaultCleanupTasks에 추가된다.

/** 기본 정리 태스크 목록 — 등록 지점(SSOT). */
export function defaultCleanupTasks(): CleanupTask[] {
  return [
    {
      name: 'expired-email-verifications',
      run: (db, now) => cleanupExpiredEmailVerifications(db, now),
    },
    {
      name: 'expired-password-reset-tokens',
      run: (db, now) => cleanupExpiredPasswordResetTokens(db, now),
    },
    {
      name: 'expired-idempotency-keys',
      run: (db, now) => cleanupExpiredIdempotencyKeys(db, now),
    },
    {
      name: 'stale-drafts',
      run: (db, now) => cleanupStaleDrafts(db, deleteBatchObject, now),
    },
    {
      name: 'pending-virus-scans',
      run: (db, now) =>
        processPendingScans(
          db,
          {
            scanner: getScanner(),
            deleteObject: deleteBatchObject,
            notifyInfected: notifyInfectedFile,
          },
          now,
        ),
    },
  ];
}

/**
 * 에러에서 PII 없이 식별 정보만 추출한다.
 * free-text message는 제외 — DB 에러 메시지에 사용자 입력(이메일 등)이 합성될 수 있어
 * name + (Prisma) code만 기록한다(BR-PII-02).
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' && code !== '' ? `${err.name}(${code})` : err.name;
  }
  return 'UnknownError';
}

/**
 * 야간 정리 배치 실행. db는 호출자가 주입한다(lib/prisma server-only 우회 — types.ts 설계 메모 참조).
 * 각 태스크는 격리 실행되어 부분 실패가 전체를 중단시키지 않는다.
 */
export async function runNightlyCleanup(
  db: BatchDb,
  now: Date = new Date(),
  tasks: CleanupTask[] = defaultCleanupTasks(),
): Promise<BatchRunResult> {
  const start = Date.now();
  const results: CleanupTaskResult[] = [];

  for (const task of tasks) {
    const t0 = Date.now();
    try {
      const deleted = await task.run(db, now);
      results.push({ name: task.name, deleted, durationMs: Date.now() - t0, error: null });
    } catch (err) {
      results.push({
        name: task.name,
        deleted: 0,
        durationMs: Date.now() - t0,
        error: describeError(err),
      });
    }
  }

  return {
    tasks: results,
    totalDeleted: results.reduce((sum, r) => sum + r.deleted, 0),
    hasError: results.some((r) => r.error !== null),
    durationMs: Date.now() - start,
  };
}
