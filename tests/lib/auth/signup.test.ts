import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';

// Step 3 fix(Step 2 review D3): instanceof 가드 통과를 위해 PrismaClientKnownRequestError 직접 생성.
function fakePrismaP2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  const err = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
  return err;
}

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
  // clearAllMocks(호출 이력만 초기화)로 factory 기본 impl(jwt/session)을 보존한다.
  // CANDID-046: 기존 afterEach(vi.restoreAllMocks()) 제거 — 전역 restore가 워커 공유 시
  //   다음 파일의 vi.mock('@/lib/prisma') 상태를 비워 간헐 실패를 유발했다.
  // 불변식(CANDID-046 리뷰 M001): clearAllMocks는 impl/`*Once` 큐를 비우지 않으므로,
  //   이 파일의 모든 mockImplementationOnce / mock*ValueOnce는 같은 테스트 내에서 1회씩
  //   소비되어야 한다 (미소비 once 큐가 다음 테스트로 누수되면 순서 의존 실패 발생).
  vi.clearAllMocks();
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
    const createCalls = txMocks.user.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const createCall = createCalls[0]?.[0] ?? { data: {} };
    expect(createCall.data.email).toBe('newuser@example.com');
    expect(createCall.data.termsAgreedAt).toBeInstanceOf(Date);
    expect(createCall.data.privacyAgreedAt).toBeInstanceOf(Date);
    expect(createCall.data.ageConfirmedAt).toBeInstanceOf(Date);
    expect(createCall.data.marketingAgreedAt).toBeNull();
    expect(createCall.data.passwordHash).toMatch(/^\$2[ab]\$12\$/); // bcrypt 12 rounds

    // emailVerification는 sha256 해시 + 24h 만료 + lastSentAt
    const evCalls = txMocks.emailVerification.create.mock.calls as unknown as Array<
      [{ data: { tokenHash: string; expiresAt: Date; lastSentAt: Date } }]
    >;
    const evCall = evCalls[0]?.[0] ?? {
      data: { tokenHash: '', expiresAt: new Date(0), lastSentAt: new Date(0) },
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
    const calls = txMocks.user.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const data = calls[0]?.[0]?.data ?? {};
    expect(data.marketingAgreedAt).toBeInstanceOf(Date);
  });

  it('중복 이메일 — Prisma P2002 → AppError USER_EMAIL_DUPLICATED (409)', async () => {
    const p2002 = fakePrismaP2002(['email']);
    prisma.$transaction.mockRejectedValueOnce(p2002);
    await expect(createUserAndIssueTokens(validInput)).rejects.toMatchObject({
      code: 'USER_EMAIL_DUPLICATED',
      status: 409,
    });
  });

  it('Prisma P2002 — target이 email이 아니면 원본 throw (다른 unique 충돌)', async () => {
    const p2002 = fakePrismaP2002(['some_other_column']);
    prisma.$transaction.mockRejectedValueOnce(p2002);
    await expect(createUserAndIssueTokens(validInput)).rejects.toBe(p2002);
  });

  it('Step 3 fix(D3) — `code:"P2002"`인 임의 객체는 instanceof 가드 미통과로 원본 throw', async () => {
    // Plain Error에 code 속성만 부착한 가짜 P2002 — instanceof Prisma.PrismaClientKnownRequestError 미통과
    const fake = Object.assign(new Error('Fake P2002'), {
      code: 'P2002',
      meta: { target: ['email'] },
    });
    prisma.$transaction.mockRejectedValueOnce(fake);
    await expect(createUserAndIssueTokens(validInput)).rejects.toBe(fake);
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
    // D3 fix 이후: 정상 Prisma 에러로 fake 생성 → instanceof 가드 통과 → AppError 변환
    const p2002 = fakePrismaP2002(['email']);
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
