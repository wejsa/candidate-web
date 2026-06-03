import { getEnv } from '@/lib/env';
import type { BatchDb } from '@/lib/batch/types';

// CANDID-029 Step 1 — 만료 행 정리 (BR-PII-03/04 자동 파기 + 인프라 정합).
//
// 대상 3종:
//   1. email_verifications — consumedAt 또는 expiresAt이 보존 일수 경과 (CANDID-010 FU).
//   2. password_reset_tokens — expiresAt 경과(일회용·30분 TTL).
//   3. idempotency_keys — expiresAt 경과(24h TTL; lookup lazy-delete 양면 정리, CANDID-018 D-H005).
//
// 모든 삭제는 청크 페이지네이션으로 처리한다 — 단일 거대 DELETE는 long-running tx +
// autovacuum 지연을 유발(db-designer 권고). 각 함수는 멱등(재실행 안전).
// 인덱스: idx_email_verifications_expires / idx_password_reset_tokens_expires / idx_idempotency_expires
// (모두 기존 마이그레이션에 존재 — 신규 마이그레이션 불필요).

const MS_PER_DAY = 86_400_000;

function subDays(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/**
 * 조건에 맞는 행을 청크 단위로 찾아 삭제하기를 반복한다.
 * 종료 조건: 더 찾을 행이 없거나(빈 청크), 마지막 청크가 chunkSize 미만일 때.
 * (deleteRows가 비정상적으로 0을 반환해도 rows.length < chunkSize 가드로 무한 루프 방지.)
 */
async function deleteAllChunks<T>(
  findChunk: (take: number) => Promise<T[]>,
  deleteRows: (rows: T[]) => Promise<number>,
  chunkSize: number,
): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await findChunk(chunkSize);
    if (rows.length === 0) break;
    total += await deleteRows(rows);
    if (rows.length < chunkSize) break;
  }
  return total;
}

/** email_verifications: consumedAt 또는 expiresAt이 EMAIL_VERIFICATION_RETENTION_DAYS 경과한 행 삭제. */
export async function cleanupExpiredEmailVerifications(
  db: BatchDb,
  now: Date = new Date(),
  chunkSize: number = getEnv().BATCH_DELETE_CHUNK,
): Promise<number> {
  const cutoff = subDays(now, getEnv().EMAIL_VERIFICATION_RETENTION_DAYS);
  return deleteAllChunks(
    (take) =>
      db.emailVerification.findMany({
        where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] },
        select: { id: true },
        take,
        orderBy: { id: 'asc' },
      }),
    async (rows) =>
      (await db.emailVerification.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }))
        .count,
    chunkSize,
  );
}

/** password_reset_tokens: expiresAt이 now 이전인(만료) 행 삭제. */
export async function cleanupExpiredPasswordResetTokens(
  db: BatchDb,
  now: Date = new Date(),
  chunkSize: number = getEnv().BATCH_DELETE_CHUNK,
): Promise<number> {
  return deleteAllChunks(
    (take) =>
      db.passwordResetToken.findMany({
        where: { expiresAt: { lt: now } },
        select: { id: true },
        take,
        orderBy: { id: 'asc' },
      }),
    async (rows) =>
      (await db.passwordResetToken.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }))
        .count,
    chunkSize,
  );
}

/** idempotency_keys: expiresAt이 now 이전인(만료) 행 삭제. 복합 PK(userId, key)라 OR 페어로 삭제. */
export async function cleanupExpiredIdempotencyKeys(
  db: BatchDb,
  now: Date = new Date(),
  chunkSize: number = getEnv().BATCH_DELETE_CHUNK,
): Promise<number> {
  return deleteAllChunks(
    (take) =>
      db.idempotencyKey.findMany({
        where: { expiresAt: { lt: now } },
        select: { userId: true, key: true },
        take,
        orderBy: [{ userId: 'asc' }, { key: 'asc' }],
      }),
    async (rows) =>
      (
        await db.idempotencyKey.deleteMany({
          where: { OR: rows.map((r) => ({ userId: r.userId, key: r.key })) },
        })
      ).count,
    chunkSize,
  );
}
