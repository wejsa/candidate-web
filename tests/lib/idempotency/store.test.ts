// CANDID-018 Step 1 — idempotency store 단위 테스트.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  return {
    basePrisma: {
      idempotencyKey: { findUnique, upsert },
    },
    prisma: {},
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: { idempotencyKey: { findUnique: Mock; upsert: Mock } };
};
const { lookupByUserKey, storeResponse, hashRequestBody } = await import(
  '@/lib/idempotency/store'
);
const { IDEMPOTENCY_TTL_MS } = await import('@/lib/idempotency/types');

const USER_ID = 42;
const KEY = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-05-26T23:00:00Z');

beforeEach(() => {
  basePrisma.idempotencyKey.findUnique.mockReset();
  basePrisma.idempotencyKey.upsert.mockReset();
});

describe('hashRequestBody', () => {
  it('동일 body는 동일 SHA-256 해시', () => {
    const a = hashRequestBody({ x: 1, y: 'a' });
    const b = hashRequestBody({ x: 1, y: 'a' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('다른 body는 다른 해시', () => {
    expect(hashRequestBody({ x: 1 })).not.toBe(hashRequestBody({ x: 2 }));
  });

  it('null/undefined도 결정적 해시', () => {
    expect(hashRequestBody(null)).toBe(hashRequestBody(undefined));
  });
});

describe('lookupByUserKey', () => {
  it('미존재 키 → null', async () => {
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null);
    const result = await lookupByUserKey(USER_ID, KEY, NOW);
    expect(result).toBeNull();
    expect(basePrisma.idempotencyKey.findUnique).toHaveBeenCalledWith({
      where: { userId_key: { userId: USER_ID, key: KEY } },
      select: { responseJson: true, responseStatus: true, requestHash: true, expiresAt: true },
    });
  });

  it('유효한 키 → 레코드 반환', async () => {
    const futureExp = new Date(NOW.getTime() + 1000);
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseJson: { applicationNumber: 'A-202605-00001' },
      responseStatus: 200,
      requestHash: 'abc',
      expiresAt: futureExp,
    });
    const result = await lookupByUserKey(USER_ID, KEY, NOW);
    expect(result).not.toBeNull();
    expect(result?.responseStatus).toBe(200);
  });

  it('만료된 키(expiresAt <= now) → null', async () => {
    const expiredAt = new Date(NOW.getTime() - 1);
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseJson: { x: 1 },
      responseStatus: 200,
      requestHash: 'h',
      expiresAt: expiredAt,
    });
    const result = await lookupByUserKey(USER_ID, KEY, NOW);
    expect(result).toBeNull();
  });

  it('만료 경계 (expiresAt === now) → null', async () => {
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseJson: {},
      responseStatus: 200,
      requestHash: 'h',
      expiresAt: NOW,
    });
    expect(await lookupByUserKey(USER_ID, KEY, NOW)).toBeNull();
  });
});

describe('storeResponse', () => {
  it('upsert + expiresAt = now + 24h', async () => {
    basePrisma.idempotencyKey.upsert.mockResolvedValueOnce({});
    await storeResponse({
      userId: USER_ID,
      key: KEY,
      requestHash: 'abc',
      responseJson: { applicationNumber: 'A-202605-00001' },
      responseStatus: 200,
      now: NOW,
    });
    const call = basePrisma.idempotencyKey.upsert.mock.calls[0]?.[0] as {
      where: unknown;
      create: { expiresAt: Date };
      update: { expiresAt: Date };
    };
    const expected = new Date(NOW.getTime() + IDEMPOTENCY_TTL_MS);
    expect(call.create.expiresAt.getTime()).toBe(expected.getTime());
    expect(call.update.expiresAt.getTime()).toBe(expected.getTime());
  });

  it('동일 키 재저장 시 upsert로 덮어쓰기 (update 분기)', async () => {
    basePrisma.idempotencyKey.upsert.mockResolvedValueOnce({});
    await storeResponse({
      userId: USER_ID,
      key: KEY,
      requestHash: 'new-hash',
      responseJson: { newField: true },
      responseStatus: 200,
    });
    const call = basePrisma.idempotencyKey.upsert.mock.calls[0]?.[0] as {
      where: { userId_key: { userId: number; key: string } };
      update: { requestHash: string };
    };
    expect(call.where.userId_key.userId).toBe(USER_ID);
    expect(call.where.userId_key.key).toBe(KEY);
    expect(call.update.requestHash).toBe('new-hash');
  });
});
