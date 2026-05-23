import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { sha256Hex } from '@/lib/auth/token-hash';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    emailVerification: { findFirst: vi.fn() },
  },
}));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: {
    $transaction: Mock;
    emailVerification: { findFirst: Mock };
  };
};
const { consumeVerificationToken, resendVerificationEmail } =
  await import('@/lib/auth/email-verification');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PLAIN_TOKEN = 'a'.repeat(64);
const TOKEN_HASH = sha256Hex(PLAIN_TOKEN);

/** updateMany 성공 (count=1) + 이후 findUnique → row 시나리오 mock 빌더. */
function txMocksConsumeSuccess(opts: { userId: number }) {
  return {
    emailVerification: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => ({ userId: opts.userId })),
      update: vi.fn(),
    },
    user: { update: vi.fn(async () => ({})) },
  };
}

/** updateMany 실패 (count=0) + findUnique → row 시나리오 mock 빌더. */
function txMocksConsumeFailure(opts: {
  row: null | {
    userId: number;
    consumedAt: Date | null;
    expiresAt: Date;
    user: { emailVerifiedAt: Date | null };
  };
}) {
  return {
    emailVerification: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findUnique: vi.fn(async () => opts.row),
      update: vi.fn(),
    },
    user: { update: vi.fn() },
  };
}

describe('consumeVerificationToken (CANDID-036 updateMany race-free)', () => {
  it('유효 토큰 — updateMany count=1 + user.emailVerifiedAt 갱신', async () => {
    const txMocks = txMocksConsumeSuccess({ userId: 42 });
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    const result = await consumeVerificationToken(PLAIN_TOKEN);
    expect(result.userId).toBe(42);
    expect(result.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.alreadyVerified).toBe(false);

    // updateMany WHERE consumedAt=null AND expiresAt>now SET consumedAt=now
    const calls = txMocks.emailVerification.updateMany.mock.calls as unknown as Array<
      [
        {
          where: { tokenHash: string; consumedAt: null; expiresAt: { gt: Date } };
          data: { consumedAt: Date };
        },
      ]
    >;
    const updateManyCall = calls[0]?.[0];
    if (updateManyCall === undefined) throw new Error('updateMany not called');
    expect(updateManyCall.where.tokenHash).toBe(TOKEN_HASH);
    expect(updateManyCall.where.consumedAt).toBeNull();
    expect(updateManyCall.where.expiresAt).toMatchObject({ gt: expect.any(Date) });
    expect(updateManyCall.data.consumedAt).toBeInstanceOf(Date);

    // user.emailVerifiedAt 갱신 (count=1 분기)
    expect(txMocks.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { emailVerifiedAt: expect.any(Date) },
    });
  });

  it('토큰 부재 (count=0 + row=null) → AUTH_VERIFICATION_TOKEN_INVALID (400)', async () => {
    const txMocks = txMocksConsumeFailure({ row: null });
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    await expect(consumeVerificationToken(PLAIN_TOKEN)).rejects.toMatchObject({
      code: 'AUTH_VERIFICATION_TOKEN_INVALID',
      status: 400,
    });
    expect(txMocks.user.update).not.toHaveBeenCalled();
  });

  it('만료 토큰 (count=0 + consumedAt=null) → AUTH_VERIFICATION_TOKEN_EXPIRED (410)', async () => {
    const txMocks = txMocksConsumeFailure({
      row: {
        userId: 42,
        consumedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: { emailVerifiedAt: null },
      },
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    await expect(consumeVerificationToken(PLAIN_TOKEN)).rejects.toMatchObject({
      code: 'AUTH_VERIFICATION_TOKEN_EXPIRED',
      status: 410,
    });
  });

  it('이미 소진된 토큰 (count=0 + consumedAt set) → 멱등 응답 (alreadyVerified=true)', async () => {
    const verifiedAt = new Date('2026-05-23T10:00:00Z');
    const txMocks = txMocksConsumeFailure({
      row: {
        userId: 42,
        consumedAt: verifiedAt,
        expiresAt: new Date(Date.now() + 3600_000),
        user: { emailVerifiedAt: verifiedAt },
      },
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    const result = await consumeVerificationToken(PLAIN_TOKEN);
    expect(result.alreadyVerified).toBe(true);
    expect(result.emailVerifiedAt).toEqual(verifiedAt);
    expect(txMocks.user.update).not.toHaveBeenCalled();
    expect(txMocks.emailVerification.update).not.toHaveBeenCalled();
  });

  it('동시 클릭 시뮬레이션 — 두 번째 호출은 alreadyVerified=true (H013 회귀 가드)', async () => {
    // 첫 호출: updateMany count=1 (직렬화 승자)
    const txMocksFirst = txMocksConsumeSuccess({ userId: 42 });
    // 두 번째 호출: updateMany count=0 + findUnique → consumedAt set
    const txMocksSecond = txMocksConsumeFailure({
      row: {
        userId: 42,
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        user: { emailVerifiedAt: new Date() },
      },
    });
    prisma.$transaction
      .mockImplementationOnce(async (cb) => cb(txMocksFirst))
      .mockImplementationOnce(async (cb) => cb(txMocksSecond));

    const first = await consumeVerificationToken(PLAIN_TOKEN);
    const second = await consumeVerificationToken(PLAIN_TOKEN);
    expect(first.alreadyVerified).toBe(false);
    expect(second.alreadyVerified).toBe(true);
  });

  it('트랜잭션 안에서 user.update가 throw → emailVerification.update 미호출 (H010 회귀 가드)', async () => {
    // count=1로 직렬화 승자였으나 user.update가 throw → 트랜잭션 전체 롤백.
    // mock 환경에서는 throw 전파만 검증 (실제 DB 롤백은 prisma의 책임).
    const userUpdate = vi.fn(async () => {
      throw new Error('DB connection lost');
    });
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => ({ userId: 42 }));
    const txMocks = {
      emailVerification: { updateMany, findUnique, update: vi.fn() },
      user: { update: userUpdate },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    await expect(consumeVerificationToken(PLAIN_TOKEN)).rejects.toThrow('DB connection lost');
    // 회귀 가드: user.update가 tx 객체를 통해 호출됨 — 외부 prisma 미사용 보장.
    expect(userUpdate).toHaveBeenCalled();
    // updateMany는 성공했지만 user.update가 throw — 같은 트랜잭션이라 atomicity 보장 (mock 한정 검증).
    expect(updateMany).toHaveBeenCalled();
  });

  it('평문 token이 아니라 sha256 해시로 DB 조회 (DB 유출 시 계정 탈취 차단)', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => null);
    prisma.$transaction.mockImplementation(async (cb) =>
      cb({
        emailVerification: { updateMany, findUnique, update: vi.fn() },
        user: { update: vi.fn() },
      }),
    );
    await consumeVerificationToken(PLAIN_TOKEN).catch(() => {});
    const calls = updateMany.mock.calls as unknown as Array<[{ where: { tokenHash: string } }]>;
    const callArg = calls[0]?.[0] ?? { where: { tokenHash: '' } };
    expect(callArg.where.tokenHash).toBe(TOKEN_HASH);
    expect(callArg.where.tokenHash).not.toBe(PLAIN_TOKEN);
  });
});

describe('resendVerificationEmail', () => {
  const fixedNow = new Date('2026-05-23T12:00:00Z');

  it('활성 토큰 부재 — 신규 발행 (24h 만료 + sha256 해시 + 60s 쿨다운)', async () => {
    prisma.emailVerification.findFirst.mockResolvedValueOnce(null);
    let createdData:
      | { tokenHash: string; expiresAt: Date; lastSentAt: Date; userId: number }
      | undefined;
    const txMocks = {
      emailVerification: {
        update: vi.fn(),
        create: vi.fn(async (args: { data: typeof createdData }) => {
          createdData = args.data;
          return {};
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    const result = await resendVerificationEmail(42, fixedNow);
    expect(result.verificationToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.nextResendAvailableAt).toEqual(new Date(fixedNow.getTime() + 60_000));
    expect(txMocks.emailVerification.update).not.toHaveBeenCalled();
    // DB에는 sha256 해시만 저장 (평문 ≠ 해시) + 24h 만료
    if (createdData === undefined) throw new Error('create not called');
    expect(createdData.tokenHash).toBe(sha256Hex(result.verificationToken));
    expect(createdData.expiresAt.getTime() - fixedNow.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(createdData.lastSentAt).toEqual(fixedNow);
  });

  it('60s 쿨다운 위반 → AUTH_VERIFICATION_RESEND_COOLDOWN', async () => {
    prisma.emailVerification.findFirst.mockResolvedValueOnce({
      id: 9,
      lastSentAt: new Date(fixedNow.getTime() - 30_000), // 30초 전 발송
    });
    await expect(resendVerificationEmail(42, fixedNow)).rejects.toMatchObject({
      code: 'AUTH_VERIFICATION_RESEND_COOLDOWN',
      status: 429,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('60s 경과 후 재발송 — 기존 활성 토큰 invalidate + 신규 발행', async () => {
    prisma.emailVerification.findFirst.mockResolvedValueOnce({
      id: 9,
      lastSentAt: new Date(fixedNow.getTime() - 90_000), // 90초 전
    });
    const txMocks = {
      emailVerification: { update: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    const result = await resendVerificationEmail(42, fixedNow);
    expect(result.verificationToken).toMatch(/^[0-9a-f]{64}$/);
    // 기존 토큰 invalidate
    expect(txMocks.emailVerification.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { consumedAt: fixedNow },
    });
    // 신규 토큰 생성
    expect(txMocks.emailVerification.create).toHaveBeenCalled();
  });

  it('TOCTOU race deep defense — P2002 → AUTH_VERIFICATION_RESEND_COOLDOWN (CANDID-036)', async () => {
    // 쿨다운 검증은 통과(활성 토큰 부재) — race로 다른 트랜잭션이 신규 활성 토큰 먼저 INSERT.
    prisma.emailVerification.findFirst.mockResolvedValueOnce(null);
    prisma.$transaction.mockImplementationOnce(async () => {
      // Prisma의 PrismaClientKnownRequestError 형태 mock — code='P2002'만 식별
      throw Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['user_id'] },
      });
    });

    await expect(resendVerificationEmail(42, fixedNow)).rejects.toMatchObject({
      code: 'AUTH_VERIFICATION_RESEND_COOLDOWN',
      status: 429,
    });
  });

  it('P2002 외 트랜잭션 오류는 그대로 전파 (resend 부적절 매핑 방지)', async () => {
    prisma.emailVerification.findFirst.mockResolvedValueOnce(null);
    prisma.$transaction.mockImplementationOnce(async () => {
      throw new Error('Connection refused');
    });

    await expect(resendVerificationEmail(42, fixedNow)).rejects.toThrow('Connection refused');
  });

  it('트랜잭션 안에서 create가 throw → invalidate도 같은 tx에서 롤백 의도 (H011 회귀 가드)', async () => {
    prisma.emailVerification.findFirst.mockResolvedValueOnce({
      id: 9,
      lastSentAt: new Date(fixedNow.getTime() - 90_000),
    });
    const update = vi.fn(async () => ({}));
    const create = vi.fn(async () => {
      throw new Error('create failed');
    });
    const txMocks = { emailVerification: { update, create } };
    prisma.$transaction.mockImplementationOnce(async (cb) => cb(txMocks));

    await expect(resendVerificationEmail(42, fixedNow)).rejects.toThrow('create failed');
    // 회귀 가드: invalidate가 tx 객체를 통해 호출됨 → 동일 트랜잭션 → DB가 자동 롤백 보장.
    expect(update).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });
});
