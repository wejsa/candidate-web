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
const { consumeVerificationToken, resendVerificationEmail } = await import(
  '@/lib/auth/email-verification'
);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PLAIN_TOKEN = 'a'.repeat(64);
const TOKEN_HASH = sha256Hex(PLAIN_TOKEN);

describe('consumeVerificationToken', () => {
  it('유효 토큰 — user.emailVerifiedAt + consumedAt 원자 갱신', async () => {
    const txMocks = {
      emailVerification: {
        findUnique: vi.fn(async () => ({
          id: 1,
          userId: 42,
          expiresAt: new Date(Date.now() + 3600_000),
          consumedAt: null,
          user: { emailVerifiedAt: null },
        })),
        update: vi.fn(async () => ({})),
      },
      user: { update: vi.fn(async () => ({})) },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    const result = await consumeVerificationToken(PLAIN_TOKEN);
    expect(result.userId).toBe(42);
    expect(result.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.alreadyVerified).toBe(false);
    expect(txMocks.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(txMocks.emailVerification.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('토큰 부재 → AUTH_VERIFICATION_TOKEN_INVALID (400)', async () => {
    const txMocks = {
      emailVerification: { findUnique: vi.fn(async () => null), update: vi.fn() },
      user: { update: vi.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));
    await expect(consumeVerificationToken(PLAIN_TOKEN)).rejects.toMatchObject({
      code: 'AUTH_VERIFICATION_TOKEN_INVALID',
      status: 400,
    });
  });

  it('만료 토큰 → AUTH_VERIFICATION_TOKEN_EXPIRED (410)', async () => {
    const txMocks = {
      emailVerification: {
        findUnique: vi.fn(async () => ({
          id: 1,
          userId: 42,
          expiresAt: new Date(Date.now() - 1000), // 1초 전 만료
          consumedAt: null,
          user: { emailVerifiedAt: null },
        })),
        update: vi.fn(),
      },
      user: { update: vi.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));
    await expect(consumeVerificationToken(PLAIN_TOKEN)).rejects.toMatchObject({
      code: 'AUTH_VERIFICATION_TOKEN_EXPIRED',
      status: 410,
    });
  });

  it('이미 소진된 토큰 → 멱등 응답 (alreadyVerified=true, throw 없음)', async () => {
    const verifiedAt = new Date('2026-05-23T10:00:00Z');
    const txMocks = {
      emailVerification: {
        findUnique: vi.fn(async () => ({
          id: 1,
          userId: 42,
          expiresAt: new Date(Date.now() + 3600_000),
          consumedAt: verifiedAt,
          user: { emailVerifiedAt: verifiedAt },
        })),
        update: vi.fn(),
      },
      user: { update: vi.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));

    const result = await consumeVerificationToken(PLAIN_TOKEN);
    expect(result.alreadyVerified).toBe(true);
    expect(result.emailVerifiedAt).toEqual(verifiedAt);
    expect(txMocks.user.update).not.toHaveBeenCalled();
    expect(txMocks.emailVerification.update).not.toHaveBeenCalled();
  });

  it('평문 token이 아니라 sha256 해시로 DB 조회 (DB 유출 시 계정 탈취 차단)', async () => {
    const findUnique = vi.fn(async () => null);
    prisma.$transaction.mockImplementation(async (cb) =>
      cb({ emailVerification: { findUnique, update: vi.fn() }, user: { update: vi.fn() } }),
    );
    await consumeVerificationToken(PLAIN_TOKEN).catch(() => {});
    const calls = findUnique.mock.calls as unknown as Array<[{ where: { tokenHash: string } }]>;
    const callArg = calls[0]?.[0] ?? { where: { tokenHash: '' } };
    expect(callArg.where.tokenHash).toBe(TOKEN_HASH);
    expect(callArg.where.tokenHash).not.toBe(PLAIN_TOKEN);
  });
});

describe('resendVerificationEmail', () => {
  const fixedNow = new Date('2026-05-23T12:00:00Z');

  it('활성 토큰 부재 — 신규 발행 (24h 만료 + sha256 해시 + 60s 쿨다운)', async () => {
    prisma.emailVerification.findFirst.mockResolvedValueOnce(null);
    let createdData: { tokenHash: string; expiresAt: Date; lastSentAt: Date } | undefined;
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
    expect(createdData?.tokenHash).toBe(sha256Hex(result.verificationToken));
    expect(createdData?.expiresAt.getTime() - fixedNow.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(createdData?.lastSentAt).toEqual(fixedNow);
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

  // 24h 만료 + sha256 해시 검증은 "활성 토큰 부재 — 신규 발행" 케이스에 통합됨.
});
