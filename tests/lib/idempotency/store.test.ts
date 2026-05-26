// CANDID-018 Step 1 — idempotency store 단위 테스트.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const findUnique = vi.fn();
  const create = vi.fn();
  const deleteFn = vi.fn();
  return {
    basePrisma: {
      idempotencyKey: { findUnique, create, delete: deleteFn },
    },
    prisma: {},
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: { idempotencyKey: { findUnique: Mock; create: Mock; delete: Mock } };
};
const {
  lookupByUserKey,
  lookupAndVerify,
  storeResponse,
  hashRequestBody,
  IdempotencyRequestMismatchError,
} = await import('@/lib/idempotency/store');
const { IDEMPOTENCY_TTL_MS } = await import('@/lib/idempotency/types');
const { Prisma } = await import('@prisma/client');

const USER_ID = 42;
const KEY = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-05-26T23:00:00Z');

beforeEach(() => {
  basePrisma.idempotencyKey.findUnique.mockReset();
  basePrisma.idempotencyKey.create.mockReset();
  basePrisma.idempotencyKey.delete.mockReset();
  basePrisma.idempotencyKey.delete.mockResolvedValue({}); // 기본: lazy delete 성공
});

describe('hashRequestBody (T-H003 fix: stable-stringify)', () => {
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

  it('키 순서가 다른 동일 의미 body → 같은 해시 (stable-stringify)', () => {
    expect(hashRequestBody({ a: 1, b: 2 })).toBe(hashRequestBody({ b: 2, a: 1 }));
  });

  it('중첩 객체도 키 순서 무관 결정적', () => {
    expect(hashRequestBody({ outer: { a: 1, b: 2 } })).toBe(
      hashRequestBody({ outer: { b: 2, a: 1 } }),
    );
  });

  it('배열 순서는 보존 (의미적 차이)', () => {
    expect(hashRequestBody([1, 2])).not.toBe(hashRequestBody([2, 1]));
  });
});

describe('lookupByUserKey', () => {
  it('미존재 키 → null', async () => {
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null);
    const result = await lookupByUserKey(USER_ID, KEY, NOW);
    expect(result).toBeNull();
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
    expect(result?.responseStatus).toBe(200);
  });

  it('만료된 키(expiresAt < now) → null + lazy delete 호출', async () => {
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseJson: { x: 1 },
      responseStatus: 200,
      requestHash: 'h',
      expiresAt: new Date(NOW.getTime() - 1),
    });
    expect(await lookupByUserKey(USER_ID, KEY, NOW)).toBeNull();
    // S-H006 fix: lazy delete 호출 검증 (race 무시 catch 적용)
    expect(basePrisma.idempotencyKey.delete).toHaveBeenCalledWith({
      where: { userId_key: { userId: USER_ID, key: KEY } },
    });
  });

  it('만료 경계 (expiresAt === now) → null (exclusive — D-H002)', async () => {
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseJson: {},
      responseStatus: 200,
      requestHash: 'h',
      expiresAt: NOW,
    });
    expect(await lookupByUserKey(USER_ID, KEY, NOW)).toBeNull();
  });

  // T-H002 fix: TTL 살아있는 +1ms boundary
  it('만료 직전 (expiresAt = now + 1ms) → 레코드 반환 (살아있음)', async () => {
    const aliveExp = new Date(NOW.getTime() + 1);
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseJson: { ok: true },
      responseStatus: 200,
      requestHash: 'h',
      expiresAt: aliveExp,
    });
    const result = await lookupByUserKey(USER_ID, KEY, NOW);
    expect(result).not.toBeNull();
    expect(basePrisma.idempotencyKey.delete).not.toHaveBeenCalled();
  });
});

describe('lookupAndVerify (D-H003/S-H004 fix)', () => {
  const VALID_HASH = 'abc123';

  it('미존재 → null', async () => {
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null);
    expect(await lookupAndVerify(USER_ID, KEY, VALID_HASH, NOW)).toBeNull();
  });

  it('일치하는 hash → 레코드 반환', async () => {
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseJson: {},
      responseStatus: 200,
      requestHash: VALID_HASH,
      expiresAt: new Date(NOW.getTime() + 1000),
    });
    const result = await lookupAndVerify(USER_ID, KEY, VALID_HASH, NOW);
    expect(result).not.toBeNull();
  });

  it('hash 불일치 → IdempotencyRequestMismatchError throw (위변조 감지)', async () => {
    basePrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseJson: {},
      responseStatus: 200,
      requestHash: 'original-hash',
      expiresAt: new Date(NOW.getTime() + 1000),
    });
    await expect(
      lookupAndVerify(USER_ID, KEY, 'tampered-hash', NOW),
    ).rejects.toBeInstanceOf(IdempotencyRequestMismatchError);
  });
});

describe('storeResponse (C001 fix: create-only)', () => {
  it('create + expiresAt = now + 24h', async () => {
    basePrisma.idempotencyKey.create.mockResolvedValueOnce({});
    await storeResponse({
      userId: USER_ID,
      key: KEY,
      requestHash: 'abc',
      responseJson: { applicationNumber: 'A-202605-00001' },
      responseStatus: 200,
      now: NOW,
    });
    const call = basePrisma.idempotencyKey.create.mock.calls[0]?.[0] as {
      data: { expiresAt: Date };
    };
    expect(call.data.expiresAt.getTime()).toBe(NOW.getTime() + IDEMPOTENCY_TTL_MS);
  });

  it('P2002 race → 첫 응답 winner (덮어쓰기 안 함, invariant 유지)', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    basePrisma.idempotencyKey.create.mockRejectedValueOnce(p2002);
    // P2002 → throw 안 함 (정상 종료)
    await expect(
      storeResponse({
        userId: USER_ID,
        key: KEY,
        requestHash: 'race-hash',
        responseJson: { race: true },
        responseStatus: 200,
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });

  it('non-P2002 에러는 그대로 throw', async () => {
    basePrisma.idempotencyKey.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      storeResponse({
        userId: USER_ID,
        key: KEY,
        requestHash: 'h',
        responseJson: {},
        responseStatus: 200,
      }),
    ).rejects.toThrow('db down');
  });
});
