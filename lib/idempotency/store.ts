// CANDID-018 Step 1 — Idempotency 키 저장소 (BR-APP-06).
//
// 멱등성 invariant: 같은 (userId, key) 재요청은 24시간 동안 첫 응답을 그대로 반환.
//   - lookupAndVerify: requestHash 검증 강제 (key 재사용 + 다른 body 시 throw)
//   - storeResponse: create-only (P2002 → 첫 응답 winner)
//
// L-019 in-task self-correction (PR #67 review fix loop 1):
//   - C001 fix: upsert 덮어쓰기 race로 invariant 침해 → create-only 변경
//   - D-H003/S-H004 fix: requestHash 비교를 lookupAndVerify로 강제
//   - T-H003 fix: stable-stringify로 키 순서 비결정성 해소
//   - S-H006 fix: 만료 row lazy delete (timing oracle 회피)
//   - D-H002 명시: expiresAt <= now → 만료 (BR-APP-06 "24시간 동안" 직전까지 유효)

import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { IDEMPOTENCY_TTL_MS, type IdempotencyRecord } from '@/lib/idempotency/types';

/**
 * 같은 키 + 다른 body로 재요청이 들어왔을 때 throw. Route Handler가 catch하여
 * SYS_VALIDATION_FAILED(400)로 매핑한다.
 */
export class IdempotencyRequestMismatchError extends Error {
  constructor(message = 'Idempotency-Key reused with different request body') {
    super(message);
    this.name = 'IdempotencyRequestMismatchError';
  }
}

/**
 * 객체 키를 재귀 정렬하여 직렬화 — 같은 의미 body의 키 순서가 달라도 동일 해시 (T-H003 fix).
 * 배열 순서는 유지 (의미적 차이 보존).
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return (
    '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}'
  );
}

/**
 * 요청 body의 SHA-256 해시 (hex). stable-stringify 적용으로 키 순서 무관 결정적.
 */
export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

/**
 * (userId, key)로 저장된 멱등성 레코드 조회.
 * - 미존재 → null
 * - 만료(expiresAt <= now) → null + lazy delete (S-H006: timing oracle 회피)
 *
 * 만료 정책: expiresAt <= now는 만료 (exclusive). BR-APP-06 "24시간 동안" 직전까지 유효.
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
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Lazy delete — 만료 row 즉시 정리 (CANDID-029 야간 배치와 별개로 분산 cleanup).
    void basePrisma.idempotencyKey
      .delete({ where: { userId_key: { userId, key } } })
      .catch(() => undefined);
    return null;
  }
  return {
    responseJson: row.responseJson,
    responseStatus: row.responseStatus,
    requestHash: row.requestHash,
    expiresAt: row.expiresAt,
  };
}

/**
 * lookup + requestHash 검증을 단일 헬퍼로 강제 (D-H003/S-H004 fix).
 * Route Handler가 본 함수만 사용하면 위변조 감지 누락 회귀 차단.
 *
 * @throws IdempotencyRequestMismatchError 같은 키 + 다른 body 재요청
 */
export async function lookupAndVerify(
  userId: number,
  key: string,
  requestHash: string,
  now: Date = new Date(),
): Promise<IdempotencyRecord | null> {
  const record = await lookupByUserKey(userId, key, now);
  if (record === null) return null;
  if (record.requestHash !== requestHash) {
    throw new IdempotencyRequestMismatchError();
  }
  return record;
}

interface StoreInput {
  userId: number;
  key: string;
  requestHash: string;
  /**
   * 응답 본문 — **PII-free 강제** (S-H001):
   *   허용: applicationNumber, submittedAt, currentStage 등 식별 메타데이터
   *   금지: name, phone, birthDate, address, email — BR-PII-01 위반 (response_json은 평문 JSONB)
   */
  responseJson: unknown;
  responseStatus: number;
  now?: Date;
}

/**
 * 멱등성 레코드 저장. expiresAt = now + 24h.
 *
 * C001 fix: create-only — P2002 충돌 시 *첫 응답을 winner로 유지* (덮어쓰기 방지).
 * 정상 흐름(lookup hit → return)에서는 store가 호출되지 않음.
 * 동시 두 요청이 둘 다 miss → 둘 다 store 시도 → 한 쪽이 P2002 → 무시.
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
  try {
    await basePrisma.idempotencyKey.create({
      data: {
        userId,
        key,
        requestHash,
        responseJson: responseJson as object,
        responseStatus,
        expiresAt,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return; // 첫 응답이 이미 저장됨 — invariant 유지
    }
    throw err;
  }
}
