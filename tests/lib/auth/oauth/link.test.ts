import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// CANDID-012 Step 3 — linkOrCreateOAuthUser 단위 테스트.
// Prisma + JWT/session mock — DB 의존 제거. 트랜잭션 분기 A/B/C 결정론적 검증.

vi.mock('@/lib/prisma', () => {
  const tx = {
    authProvider: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      __tx: tx,
    },
  };
});
vi.mock('@/lib/auth/jwt', () => ({
  issueAccessToken: vi.fn(async () => ({
    token: 'oauth-access-jwt',
    expiresAt: new Date('2026-06-01T00:00:00Z'),
  })),
}));
vi.mock('@/lib/auth/session', () => ({
  issueRefreshSession: vi.fn(async () => ({
    token: 'oauth-refresh-jwt',
    expiresAt: new Date('2026-06-15T00:00:00Z'),
    userId: 99,
    familyId: 'family-uuid',
    rotationCounter: 0,
  })),
}));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: {
    $transaction: Mock;
    __tx: {
      authProvider: { findUnique: Mock };
      user: { findUnique: Mock; create: Mock };
    };
  };
};
const tx = prisma.__tx;
const { linkOrCreateOAuthUser } = await import('@/lib/auth/oauth/link');

const PROFILE = {
  providerUserId: 'g-12345',
  email: 'alice@example.com',
  emailVerified: true,
  name: 'Alice',
  profileImageUrl: 'https://avatar/x.jpg',
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('linkOrCreateOAuthUser — case A (기존 연결 signin)', () => {
  it('AuthProvider 매칭 → User signin + linkAction=signin', async () => {
    tx.authProvider.findUnique.mockResolvedValueOnce({ userId: 42 });
    tx.user.findUnique.mockResolvedValueOnce({
      id: 42,
      email: 'alice@example.com',
      name: 'Alice',
      emailVerifiedAt: new Date('2026-01-01'),
      status: 'ACTIVE',
    });

    const result = await linkOrCreateOAuthUser({ provider: 'google', profile: PROFILE });
    expect(result.linkAction).toBe('signin');
    expect(result.user.id).toBe(42);
    expect(result.tokens.accessToken).toBe('oauth-access-jwt');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('연결된 User가 LOCKED → AUTH_INVALID_CREDENTIALS', async () => {
    tx.authProvider.findUnique.mockResolvedValueOnce({ userId: 7 });
    tx.user.findUnique.mockResolvedValueOnce({
      id: 7,
      email: 'a@b.com',
      name: 'L',
      emailVerifiedAt: null,
      status: 'LOCKED',
    });
    await expect(
      linkOrCreateOAuthUser({ provider: 'github', profile: PROFILE }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });
});

describe('linkOrCreateOAuthUser — case B (BR-AUTH-06 자동 연결 차단)', () => {
  it('email 일치 User 존재 + AuthProvider 부재 → AUTH_OAUTH_EMAIL_TAKEN', async () => {
    tx.authProvider.findUnique.mockResolvedValueOnce(null);
    tx.user.findUnique.mockResolvedValueOnce({ id: 50 });

    await expect(
      linkOrCreateOAuthUser({ provider: 'google', profile: PROFILE }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_EMAIL_TAKEN' });
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('email=null 프로필이면 email lookup 스킵 → case C로 진입', async () => {
    tx.authProvider.findUnique.mockResolvedValueOnce(null);
    tx.user.create.mockResolvedValueOnce({
      id: 100,
      email: 'github-g-12345@oauth.local',
      name: 'NoEmail',
      emailVerifiedAt: null,
    });

    const result = await linkOrCreateOAuthUser({
      provider: 'github',
      profile: { ...PROFILE, email: null, emailVerified: false, name: 'NoEmail' },
    });
    expect(result.linkAction).toBe('created');
    expect(result.user.email).toBe('github-g-12345@oauth.local');
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('linkOrCreateOAuthUser — case C (신규 가입)', () => {
  it('User + AuthProvider 동시 생성 + emailVerified=true → emailVerifiedAt=now', async () => {
    tx.authProvider.findUnique.mockResolvedValueOnce(null);
    tx.user.findUnique.mockResolvedValueOnce(null);
    tx.user.create.mockResolvedValueOnce({
      id: 200,
      email: 'alice@example.com',
      name: 'Alice',
      emailVerifiedAt: new Date('2026-05-24'),
    });

    const result = await linkOrCreateOAuthUser({ provider: 'google', profile: PROFILE });
    expect(result.linkAction).toBe('created');
    expect(tx.user.create).toHaveBeenCalledTimes(1);

    const createArgs = tx.user.create.mock.calls[0]?.[0] as {
      data: {
        email: string;
        passwordHash: null;
        emailVerifiedAt: Date | null;
        termsAgreedAt: Date;
        privacyAgreedAt: Date;
        authProviders: { create: { provider: string; providerUserId: string } };
      };
    };
    expect(createArgs.data.email).toBe('alice@example.com');
    expect(createArgs.data.passwordHash).toBeNull();
    expect(createArgs.data.emailVerifiedAt).not.toBeNull();
    expect(createArgs.data.termsAgreedAt).toBeInstanceOf(Date);
    expect(createArgs.data.privacyAgreedAt).toBeInstanceOf(Date);
    expect(createArgs.data.authProviders.create.provider).toBe('GOOGLE');
    expect(createArgs.data.authProviders.create.providerUserId).toBe('g-12345');
  });

  it('emailVerified=false → emailVerifiedAt=null (BR-AUTH-04 지원서 시점 차단)', async () => {
    tx.authProvider.findUnique.mockResolvedValueOnce(null);
    tx.user.findUnique.mockResolvedValueOnce(null);
    tx.user.create.mockResolvedValueOnce({
      id: 201,
      email: 'b@x.com',
      name: 'B',
      emailVerifiedAt: null,
    });

    await linkOrCreateOAuthUser({
      provider: 'github',
      profile: { ...PROFILE, email: 'b@x.com', emailVerified: false },
    });
    const createArgs = tx.user.create.mock.calls[0]?.[0] as {
      data: { emailVerifiedAt: Date | null };
    };
    expect(createArgs.data.emailVerifiedAt).toBeNull();
  });

  it('P2002 (race condition: email/provider_pid UNIQUE) → AUTH_OAUTH_EMAIL_TAKEN', async () => {
    const { Prisma } = await import('@prisma/client');
    tx.authProvider.findUnique.mockResolvedValueOnce(null);
    tx.user.findUnique.mockResolvedValueOnce(null);
    tx.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('P2002', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['users_email_key'] },
      }),
    );

    await expect(
      linkOrCreateOAuthUser({ provider: 'google', profile: PROFILE }),
    ).rejects.toMatchObject({ code: 'AUTH_OAUTH_EMAIL_TAKEN' });
  });

  it('P2002이지만 다른 target → 원본 throw (오매핑 회귀 차단)', async () => {
    const { Prisma } = await import('@prisma/client');
    tx.authProvider.findUnique.mockResolvedValueOnce(null);
    tx.user.findUnique.mockResolvedValueOnce(null);
    tx.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('P2002', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['some_other_index'] },
      }),
    );

    await expect(
      linkOrCreateOAuthUser({ provider: 'google', profile: PROFILE }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
