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
// bcrypt는 느리므로(~250ms) 단위 테스트에서 mock — 해시 호출 여부/값 전달만 검증.
vi.mock('@/lib/auth/password', () => ({
  hashPassword: vi.fn(async () => '$2b$12$mockedhashmockedhashmockedhashmockedhash'),
}));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: {
    $transaction: Mock;
    user: { findUnique: Mock };
  };
};
const { hashPassword } = (await import('@/lib/auth/password')) as unknown as {
  hashPassword: Mock;
};
const { requestPasswordReset, resetPassword } = await import('@/lib/auth/password-reset');

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

const MOCK_HASH = '$2b$12$mockedhashmockedhashmockedhashmockedhash';

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks가 factory 기본 impl을 초기화하므로 bcrypt mock을 재설정.
  hashPassword.mockResolvedValue(MOCK_HASH);
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

/** resetPassword용 tx mock — consume(updateMany) + findUnique + user.update + refreshToken.updateMany. */
function makeResetTxMock(opts: {
  consumeCount: number;
  /** count=0일 때 사후 findUnique 결과 (consumedAt). null이면 부재. */
  postRow?: { consumedAt: Date | null } | null;
  userId?: number;
  revokedCount?: number;
}) {
  const tx = {
    passwordResetToken: {
      updateMany: vi.fn(async (_args: unknown) => ({ count: opts.consumeCount })),
      // count=1이면 userId row, count=0이면 사후 분류용 postRow.
      findUnique: vi.fn(async (_args: unknown) =>
        opts.consumeCount > 0 ? { userId: opts.userId ?? 7 } : (opts.postRow ?? null),
      ),
    },
    user: { update: vi.fn(async (_args: unknown) => ({})) },
    refreshToken: { updateMany: vi.fn(async (_args: unknown) => ({ count: opts.revokedCount ?? 0 })) },
  };
  return tx;
}

const PLAIN_TOKEN = 'c'.repeat(64);

describe('resetPassword — 정상 (consume + 비번 변경 + 세션 무효화)', () => {
  it('count=1 승자: passwordHash 갱신 + 모든 refresh revoke(password_change) + 결과 반환', async () => {
    const tx = makeResetTxMock({ consumeCount: 1, userId: 7, revokedCount: 3 });
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    const result = await resetPassword(PLAIN_TOKEN, 'NewPassw0rd!', NOW);

    expect(result).toEqual({ userId: 7, revokedSessions: 3 });
    // bcrypt 해시는 트랜잭션 외부에서 1회 호출.
    expect(hashPassword).toHaveBeenCalledWith('NewPassw0rd!');
    // 새 해시로 user.passwordHash 갱신.
    const userUpdateArg = tx.user.update.mock.calls[0]![0] as {
      where: { id: number };
      data: { passwordHash: string };
    };
    expect(userUpdateArg.where.id).toBe(7);
    expect(userUpdateArg.data.passwordHash).toBe(
      '$2b$12$mockedhashmockedhashmockedhashmockedhash',
    );
    // BR-AUTH-05 — 활성 refresh 전체 revoke(password_change).
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, revokedAt: null },
      data: { revokedAt: NOW, revokedReason: 'password_change' },
    });
  });

  it('consume는 평문이 아닌 sha256(token_hash) 기준으로 수행', async () => {
    const tx = makeResetTxMock({ consumeCount: 1, userId: 7 });
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await resetPassword(PLAIN_TOKEN, 'NewPassw0rd!', NOW);

    const updateArg = tx.passwordResetToken.updateMany.mock.calls[0]![0] as {
      where: { tokenHash: string; consumedAt: null; expiresAt: { gt: Date } };
    };
    expect(updateArg.where.tokenHash).toBe(sha256Hex(PLAIN_TOKEN));
    expect(updateArg.where.tokenHash).not.toBe(PLAIN_TOKEN);
    expect(updateArg.where.consumedAt).toBeNull();
  });

  it('활성 세션 없음(revokedCount=0) — 정상 처리 + revokedSessions:0', async () => {
    const tx = makeResetTxMock({ consumeCount: 1, userId: 7, revokedCount: 0 });
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    const result = await resetPassword(PLAIN_TOKEN, 'NewPassw0rd!', NOW);

    expect(result).toEqual({ userId: 7, revokedSessions: 0 });
    // 세션이 없어도 passwordHash는 갱신된다.
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it('동시 클릭 double-consume — winner만 비번 변경, loser는 INVALID (race 회귀 가드)', async () => {
    // 첫 트랜잭션 consume count=1(승자), 두 번째 count=0 + consumedAt set(패자 — 이미 소진).
    const winnerTx = makeResetTxMock({ consumeCount: 1, userId: 7, revokedCount: 1 });
    const loserTx = makeResetTxMock({ consumeCount: 0, postRow: { consumedAt: NOW } });
    prisma.$transaction
      .mockImplementationOnce(async (fn: (t: typeof winnerTx) => unknown) => fn(winnerTx))
      .mockImplementationOnce(async (fn: (t: typeof loserTx) => unknown) => fn(loserTx));

    const results = await Promise.allSettled([
      resetPassword(PLAIN_TOKEN, 'NewPassw0rd!', NOW),
      resetPassword(PLAIN_TOKEN, 'NewPassw0rd!', NOW),
    ]);

    // 정확히 하나만 성공, 다른 하나는 INVALID. 비번 변경은 winner에서 1회만.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'AUTH_RESET_TOKEN_INVALID',
    });
    expect(winnerTx.user.update).toHaveBeenCalledTimes(1);
    expect(loserTx.user.update).not.toHaveBeenCalled();
  });
});

describe('resetPassword — 토큰 무효/만료/일회용', () => {
  it('부재 토큰(count=0, row=null) → AUTH_RESET_TOKEN_INVALID', async () => {
    const tx = makeResetTxMock({ consumeCount: 0, postRow: null });
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await expect(resetPassword(PLAIN_TOKEN, 'NewPassw0rd!', NOW)).rejects.toMatchObject({
      code: 'AUTH_RESET_TOKEN_INVALID',
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('이미 소진된 토큰 재사용(count=0, consumedAt set) → AUTH_RESET_TOKEN_INVALID (일회용)', async () => {
    const tx = makeResetTxMock({ consumeCount: 0, postRow: { consumedAt: NOW } });
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await expect(resetPassword(PLAIN_TOKEN, 'NewPassw0rd!', NOW)).rejects.toMatchObject({
      code: 'AUTH_RESET_TOKEN_INVALID',
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('만료 토큰(count=0, consumedAt=null) → AUTH_RESET_TOKEN_EXPIRED', async () => {
    const tx = makeResetTxMock({ consumeCount: 0, postRow: { consumedAt: null } });
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

    await expect(resetPassword(PLAIN_TOKEN, 'NewPassw0rd!', NOW)).rejects.toMatchObject({
      code: 'AUTH_RESET_TOKEN_EXPIRED',
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
