import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  cleanupExpiredEmailVerifications,
  cleanupExpiredIdempotencyKeys,
  cleanupExpiredPasswordResetTokens,
} from '@/lib/batch/expired-rows';

// CANDID-029 Step 1 — 만료 행 정리 단위 테스트.
// PrismaClient를 주입(DI)하므로 vi.mock('@/lib/prisma') 불필요 — 최소 구조 mock을 직접 전달한다.
// 기본 보존(EMAIL_VERIFICATION_RETENTION_DAYS=7)·청크(BATCH_DELETE_CHUNK=1000)는
// tests/setup.ts env 기본값을 따른다.

type DelegateMock = { findMany: Mock; deleteMany: Mock };

function makeDb(): {
  db: PrismaClient;
  emailVerification: DelegateMock;
  passwordResetToken: DelegateMock;
  idempotencyKey: DelegateMock;
} {
  const emailVerification = { findMany: vi.fn(), deleteMany: vi.fn() };
  const passwordResetToken = { findMany: vi.fn(), deleteMany: vi.fn() };
  const idempotencyKey = { findMany: vi.fn(), deleteMany: vi.fn() };
  const db = { emailVerification, passwordResetToken, idempotencyKey } as unknown as PrismaClient;
  return { db, emailVerification, passwordResetToken, idempotencyKey };
}

const NOW = new Date('2026-06-03T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cleanupExpiredEmailVerifications', () => {
  it('빈 결과면 삭제하지 않고 0 반환', async () => {
    const { db, emailVerification } = makeDb();
    emailVerification.findMany.mockResolvedValueOnce([]);

    const n = await cleanupExpiredEmailVerifications(db, NOW);

    expect(n).toBe(0);
    expect(emailVerification.deleteMany).not.toHaveBeenCalled();
  });

  it('consumedAt 또는 expiresAt이 7일(기본 보존) 경과한 행을 cutoff 조건으로 조회한다', async () => {
    const { db, emailVerification } = makeDb();
    emailVerification.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    emailVerification.deleteMany.mockResolvedValueOnce({ count: 2 });

    const n = await cleanupExpiredEmailVerifications(db, NOW, 1000);

    expect(n).toBe(2);
    const cutoff = new Date(NOW.getTime() - 7 * 86_400_000);
    expect(emailVerification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] },
        take: 1000,
      }),
    );
    expect(emailVerification.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2] } } });
  });

  it('청크 크기를 초과하면 다음 청크를 이어서 삭제한다(페이지네이션)', async () => {
    const { db, emailVerification } = makeDb();
    emailVerification.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 3 }]);
    emailVerification.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const n = await cleanupExpiredEmailVerifications(db, NOW, 2);

    expect(n).toBe(3);
    expect(emailVerification.findMany).toHaveBeenCalledTimes(2);
    expect(emailVerification.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('마지막 청크가 chunkSize와 정확히 일치하면 추가 빈 조회 후 종료한다(경계값)', async () => {
    // deleteAllChunks 종료 조건 `rows.length < chunkSize`의 경계 — 정확히 가득 찬 청크면
    // 한 번 더 조회해 빈 결과를 받고서야 종료한다(조기 종료/무한 루프 회귀 가드).
    const { db, emailVerification } = makeDb();
    emailVerification.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // 정확히 chunkSize=2
      .mockResolvedValueOnce([]); // 추가 빈 조회
    emailVerification.deleteMany.mockResolvedValueOnce({ count: 2 });

    const n = await cleanupExpiredEmailVerifications(db, NOW, 2);

    expect(n).toBe(2);
    expect(emailVerification.findMany).toHaveBeenCalledTimes(2);
    expect(emailVerification.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('deleteMany가 0을 반환해도 chunkSize 미만 가드로 종료한다(무한 루프 방지)', async () => {
    // 소스가 명시한 안전 계약: deleteRows가 비정상적으로 0을 반환해도 rows.length < chunkSize로 종료.
    const { db, emailVerification } = makeDb();
    emailVerification.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 3 }]); // chunkSize(2) 미만 → 종료
    emailVerification.deleteMany
      .mockResolvedValueOnce({ count: 0 }) // 경합 등으로 0 삭제
      .mockResolvedValueOnce({ count: 1 });

    const n = await cleanupExpiredEmailVerifications(db, NOW, 2);

    expect(n).toBe(1);
    expect(emailVerification.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('cleanupExpiredPasswordResetTokens', () => {
  it('expiresAt < now 조건으로 삭제한다', async () => {
    const { db, passwordResetToken } = makeDb();
    passwordResetToken.findMany.mockResolvedValueOnce([{ id: 9 }]);
    passwordResetToken.deleteMany.mockResolvedValueOnce({ count: 1 });

    const n = await cleanupExpiredPasswordResetTokens(db, NOW);

    expect(n).toBe(1);
    expect(passwordResetToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { expiresAt: { lt: NOW } } }),
    );
    expect(passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [9] } } });
  });

  it('만료 토큰이 없으면 삭제하지 않고 0 반환(멱등 재실행)', async () => {
    const { db, passwordResetToken } = makeDb();
    passwordResetToken.findMany.mockResolvedValueOnce([]);

    const n = await cleanupExpiredPasswordResetTokens(db, NOW);

    expect(n).toBe(0);
    expect(passwordResetToken.deleteMany).not.toHaveBeenCalled();
  });

  it('청크 크기를 초과하면 다음 청크를 이어서 삭제한다(페이지네이션)', async () => {
    const { db, passwordResetToken } = makeDb();
    passwordResetToken.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 3 }]);
    passwordResetToken.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const n = await cleanupExpiredPasswordResetTokens(db, NOW, 2);

    expect(n).toBe(3);
    expect(passwordResetToken.findMany).toHaveBeenCalledTimes(2);
    expect(passwordResetToken.deleteMany).toHaveBeenCalledTimes(2);
  });
});

describe('cleanupExpiredIdempotencyKeys', () => {
  it('복합 PK(userId, key)를 OR 페어로 삭제한다', async () => {
    const { db, idempotencyKey } = makeDb();
    idempotencyKey.findMany.mockResolvedValueOnce([
      { userId: 1, key: 'a' },
      { userId: 2, key: 'b' },
    ]);
    idempotencyKey.deleteMany.mockResolvedValueOnce({ count: 2 });

    const n = await cleanupExpiredIdempotencyKeys(db, NOW);

    expect(n).toBe(2);
    expect(idempotencyKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expiresAt: { lt: NOW } },
        select: { userId: true, key: true },
      }),
    );
    expect(idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: 1, key: 'a' },
          { userId: 2, key: 'b' },
        ],
      },
    });
  });

  it('만료 키가 없으면 0 반환', async () => {
    const { db, idempotencyKey } = makeDb();
    idempotencyKey.findMany.mockResolvedValueOnce([]);

    const n = await cleanupExpiredIdempotencyKeys(db, NOW);

    expect(n).toBe(0);
    expect(idempotencyKey.deleteMany).not.toHaveBeenCalled();
  });

  it('청크 크기를 초과하면 다음 청크를 이어서 삭제한다(페이지네이션)', async () => {
    const { db, idempotencyKey } = makeDb();
    idempotencyKey.findMany
      .mockResolvedValueOnce([
        { userId: 1, key: 'a' },
        { userId: 2, key: 'b' },
      ])
      .mockResolvedValueOnce([{ userId: 3, key: 'c' }]);
    idempotencyKey.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const n = await cleanupExpiredIdempotencyKeys(db, NOW, 2);

    expect(n).toBe(3);
    expect(idempotencyKey.findMany).toHaveBeenCalledTimes(2);
    expect(idempotencyKey.deleteMany).toHaveBeenCalledTimes(2);
  });
});
