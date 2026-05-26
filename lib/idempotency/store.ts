// CANDID-018 Step 1 — Idempotency 키 저장소 (BR-APP-06).
// lookupByUserKey: (userId, key)로 저장된 응답 조회 — 만료된 키는 null
// storeResponse: 24시간 TTL로 응답 저장 (트랜잭션 commit 후 호출)
// 동일 키 재요청 시 requestHash 비교로 본문 위변조 감지 (선택적).

import 'server-only';
import { createHash } from 'node:crypto';
import { basePrisma } from '@/lib/prisma';
import { IDEMPOTENCY_TTL_MS, type IdempotencyRecord } from '@/lib/idempotency/types';

/**
 * 요청 body의 SHA-256 해시 (hex). 같은 키 + 다른 본문 감지용.
 */
export function hashRequestBody(body: unknown): string {
  const serialized = JSON.stringify(body ?? null);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * (userId, key)로 저장된 멱등성 레코드 조회.
 * - 미존재 → null
 * - 만료(expiresAt < now) → null (만료 row는 야간 배치 정리 — 본 함수가 삭제하지 않음)
 */
export async function lookupByUserKey(
  userId: number,
  key: string,
  now: Date = new Date(),
): Promise<IdempotencyRecord | null> {
  const row = await basePrisma.idempotencyKey.findUnique({
    where: { userId_key: { userId, key } },
    select: { responseJson: true, responseStatus: true, requestHash: true, expiresAt: true },
  });
  if (row === null) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  return {
    responseJson: row.responseJson,
    responseStatus: row.responseStatus,
    requestHash: row.requestHash,
    expiresAt: row.expiresAt,
  };
}

interface StoreInput {
  userId: number;
  key: string;
  requestHash: string;
  responseJson: unknown;
  responseStatus: number;
  now?: Date;
}

/**
 * 멱등성 레코드 저장. expiresAt = now + 24h.
 * - upsert로 race-free 처리 — 동일 (userId, key) 재저장 시 응답 덮어쓰기
 *   (정상 흐름은 lookup → miss → tx → store이므로 race는 일반적이지 않음)
 */
export async function storeResponse({
  userId,
  key,
  requestHash,
  responseJson,
  responseStatus,
  now = new Date(),
}: StoreInput): Promise<void> {
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
  await basePrisma.idempotencyKey.upsert({
    where: { userId_key: { userId, key } },
    create: {
      userId,
      key,
      requestHash,
      responseJson: responseJson as object,
      responseStatus,
      expiresAt,
    },
    update: {
      requestHash,
      responseJson: responseJson as object,
      responseStatus,
      expiresAt,
    },
  });
}
