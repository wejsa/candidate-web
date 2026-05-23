import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AppError } from '@/lib/errors';

// Prisma + JWT + session 모듈을 mock — DB 의존 제거. signup.ts 비즈니스 로직만 검증.
// 통합(실 DB) 검증은 별도 integration 테스트에서 수행 (vitest.config.integration.ts).

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/auth/jwt', () => ({
  issueAccessToken: vi.fn(async () => ({ token: 'access-jwt', expiresAt: new Date('2026-06-01T00:00:00Z') })),
}));
vi.mock('@/lib/auth/session', () => ({
  issueRefreshSession: vi.fn(async () => ({
    token: 'refresh-jwt',
    expiresAt: new Date('2026-06-15T00:00:00Z'),
    userId: 42,
    familyId: 'family-uuid',
    rotationCounter: 0,
  })),
}));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { $transaction: Mock };
};
const { createUserAndIssueTokens } = await import('@/lib/auth/signup');

const validInput = {
  email: 'newuser@example.com',
  password: 'CorrectHorse!23',
  passwordConfirm: 'CorrectHorse!23',
  name: '홍길동',
  termsAgreed: true as const,
  privacyAgreed: true as const,
  ageConfirmed: true as const,
  marketingAgreed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createUserAndIssueTokens', () => {
  it('정상 가입 — User + EmailVerification 트랜잭션 + Access/Refresh 발급', async () => {
    const createdUser = {
      id: 42,
      email: 'newuser@example.com',
      name: '홍길동',
      emailVerifiedAt: null,
    };
    // tx 콜백을 invoke해서 내부 user.create/emailVerification.create 검증.
    const txMocks = {
      user: { create: vi.fn(async () => createdUser) },
      emailVerification: { create: vi.fn(async () => ({ id: 1 })) },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(txMocks));

    const result = await createUserAndIssueTokens(validInput);

    expect(result.user).toEqual(createdUser);
    expect(result.tokens.accessToken).toBe('access-jwt');
    expect(result.tokens.refreshToken).toBe('refresh-jwt');
    expect(result.verificationToken).toMatch(/^[0-9a-f]{64}$/);

    // 동의 시각 4종 + marketingAgreedAt=null (false 입력) 검증
    const createCall = txMocks.user.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.email).toBe('newuser@example.com');
    expect(createCall.data.termsAgreedAt).toBeInstanceOf(Date);
    expect(createCall.data.privacyAgreedAt).toBeInstanceOf(Date);
    expect(createCall.data.ageConfirmedAt).toBeInstanceOf(Date);
    expect(createCall.data.marketingAgreedAt).toBeNull();
    expect(createCall.data.passwordHash).toMatch(/^\$2[ab]\$12\$/); // bcrypt 12 rounds

    // emailVerification는 sha256 해시 + 24h 만료 + lastSentAt
    const evCall = txMocks.emailVerification.create.mock.calls[0]?.[0] as {
      data: { tokenHash: string; expiresAt: Date; lastSentAt: Date };
    };
    expect(evCall.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(evCall.data.tokenHash).not.toBe(result.verificationToken); // 평문 ≠ 해시
    const ttl = evCall.data.expiresAt.getTime() - evCall.data.lastSentAt.getTime();
    expect(ttl).toBe(24 * 60 * 60 * 1000); // 정확히 24h
  });

  it('marketingAgreed=true → marketingAgreedAt에 시각 기록', async () => {
    const txMocks = {
      user: { create: vi.fn(async () => ({ id: 1, email: 'a@b.test', name: 'X', emailVerifiedAt: null })) },
      emailVerification: { create: vi.fn(async () => ({})) },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));
    await createUserAndIssueTokens({ ...validInput, marketingAgreed: true });
    const data = (txMocks.user.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })
      .data;
    expect(data.marketingAgreedAt).toBeInstanceOf(Date);
  });

  it('중복 이메일 — Prisma P2002 → AppError USER_EMAIL_DUPLICATED (409)', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), {
      code: 'P2002',
      meta: { target: ['email'] },
    });
    prisma.$transaction.mockRejectedValueOnce(p2002);
    await expect(createUserAndIssueTokens(validInput)).rejects.toMatchObject({
      code: 'USER_EMAIL_DUPLICATED',
      status: 409,
    });
  });

  it('Prisma P2002 — target이 email이 아니면 원본 throw (다른 unique 충돌)', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), {
      code: 'P2002',
      meta: { target: ['some_other_column'] },
    });
    prisma.$transaction.mockRejectedValueOnce(p2002);
    await expect(createUserAndIssueTokens(validInput)).rejects.toBe(p2002);
  });

  it('Prisma 트랜잭션 외 일반 에러는 원본 throw (DB 연결 실패 등)', async () => {
    const err = new Error('DB connection lost');
    prisma.$transaction.mockRejectedValueOnce(err);
    await expect(createUserAndIssueTokens(validInput)).rejects.toBe(err);
  });

  it('verificationToken은 64-char hex이고 호출마다 다름 (256-bit entropy)', async () => {
    const txMocks = {
      user: { create: vi.fn(async () => ({ id: 1, email: 'a@b.test', name: 'X', emailVerifiedAt: null })) },
      emailVerification: { create: vi.fn(async () => ({})) },
    };
    prisma.$transaction.mockImplementation(async (cb) => cb(txMocks));
    const r1 = await createUserAndIssueTokens(validInput);
    const r2 = await createUserAndIssueTokens(validInput);
    expect(r1.verificationToken).not.toBe(r2.verificationToken);
    expect(r1.verificationToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('AppError 발생 시 passwordHash가 응답·로그에 노출되지 않음 (BR-AUTH-02)', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), {
      code: 'P2002',
      meta: { target: ['email'] },
    });
    prisma.$transaction.mockRejectedValueOnce(p2002);
    try {
      await createUserAndIssueTokens(validInput);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.message).not.toContain('CorrectHorse');
      expect(JSON.stringify(e.details ?? [])).not.toContain('CorrectHorse');
    }
  });
});
