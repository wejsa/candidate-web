import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma } from '@prisma/client';
import { sha256Hex } from '@/lib/auth/token-hash';

// CANDID-020 Step 2 — requestPasswordReset 단위 테스트.
// 핵심: 계정 열거 방지(적격/비적격 분기), sha256 저장, 30분 만료, consume→create 순서, race 매핑.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
  },
}));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: {
    $transaction: Mock;
    user: { findUnique: Mock };
  };
};
const { requestPasswordReset } = await import('@/lib/auth/password-reset');

/** tx mock — passwordResetToken.updateMany + create. create는 기본 성공.
 * mock fn에 인자 타입(`unknown`)을 부여해 `.mock.calls[0][0]` 인덱싱이 가능하도록 한다. */
function makeTxMock(createImpl?: (args: unknown) => unknown) {
  const tx = {
    passwordResetToken: {
      updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
      create: vi.fn(createImpl ?? (async (_args: unknown) => ({ id: 1 }))),
    },
  };
  return tx;
}

function makePrismaUniqueViolation(
  target: string | string[],
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

const ELIGIBLE_USER = {
  id: 42,
  email: 'user@example.com',
  name: '홍길동',
  status: 'ACTIVE' as const,
  passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
};
const NOW = new Date('2026-05-29T20:00:00.000Z');

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestPasswordReset — 적격 사용자', () => {
  it('토큰 발급 + 메일 인자 반환 (email/name/평문 토큰)', async () => {
    prisma.user.findUnique.mockResolvedValue(ELIGIBLE_USER);
    const tx = makeTxMock();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    const result = await requestPasswordReset('user@example.com', NOW);

    expect(result).not.toBeNull();
    expect(result?.email).toBe('user@example.com');
    expect(result?.name).toBe('홍길동');
    // 평문 토큰은 32 bytes hex (64 char).
    expect(result?.resetToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('DB에는 평문이 아닌 sha256(token_hash)만 저장한다', async () => {
    prisma.user.findUnique.mockResolvedValue(ELIGIBLE_USER);
    const tx = makeTxMock();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    const result = await requestPasswordReset('user@example.com', NOW);

    const createArg = tx.passwordResetToken.create.mock.calls[0]![0] as {
      data: { userId: number; tokenHash: string; expiresAt: Date };
    };
    // 저장된 해시는 평문의 sha256이며, 평문 자체는 저장되지 않는다.
    expect(createArg.data.tokenHash).toBe(sha256Hex(result!.resetToken));
    expect(createArg.data.tokenHash).not.toBe(result!.resetToken);
    expect(createArg.data.userId).toBe(42);
  });

  it('만료는 발급 시점 + 30분', async () => {
    prisma.user.findUnique.mockResolvedValue(ELIGIBLE_USER);
    const tx = makeTxMock();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await requestPasswordReset('user@example.com', NOW);

    const createArg = tx.passwordResetToken.create.mock.calls[0]![0] as {
      data: { expiresAt: Date };
    };
    expect(createArg.data.expiresAt.getTime() - NOW.getTime()).toBe(30 * 60 * 1000);
  });

  it('신규 INSERT 전에 기존 활성 토큰을 consume한다 (부분 UNIQUE 순서)', async () => {
    prisma.user.findUnique.mockResolvedValue(ELIGIBLE_USER);
    const tx = makeTxMock();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await requestPasswordReset('user@example.com', NOW);

    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 42, consumedAt: null },
      data: { consumedAt: NOW },
    });
    const updateOrder = tx.passwordResetToken.updateMany.mock.invocationCallOrder[0]!;
    const createOrder = tx.passwordResetToken.create.mock.invocationCallOrder[0]!;
    expect(updateOrder).toBeLessThan(createOrder);
  });
});

describe('requestPasswordReset — 비적격 (계정 열거 방지: 모두 null, 토큰 미발급)', () => {
  it('미존재 이메일 → null', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const result = await requestPasswordReset('nobody@example.com', NOW);
    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('WITHDRAWN 상태 → null', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...ELIGIBLE_USER, status: 'WITHDRAWN' });
    const result = await requestPasswordReset('user@example.com', NOW);
    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('LOCKED 상태 → null', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...ELIGIBLE_USER, status: 'LOCKED' });
    const result = await requestPasswordReset('user@example.com', NOW);
    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('소셜 전용(passwordHash NULL) → null', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...ELIGIBLE_USER, passwordHash: null });
    const result = await requestPasswordReset('user@example.com', NOW);
    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('requestPasswordReset — 동시 발급 race / 에러 매핑', () => {
  it('uk_password_reset_active_per_user P2002 → null (중복 메일 회피)', async () => {
    prisma.user.findUnique.mockResolvedValue(ELIGIBLE_USER);
    const tx = makeTxMock(async () => {
      throw makePrismaUniqueViolation('uk_password_reset_active_per_user');
    });
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    const result = await requestPasswordReset('user@example.com', NOW);
    expect(result).toBeNull();
  });

  it('token_hash UNIQUE P2002 → 시스템 에러로 전파 (null 아님)', async () => {
    prisma.user.findUnique.mockResolvedValue(ELIGIBLE_USER);
    const tx = makeTxMock(async () => {
      throw makePrismaUniqueViolation('password_reset_tokens_token_hash_key');
    });
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await expect(requestPasswordReset('user@example.com', NOW)).rejects.toThrow();
  });
});
