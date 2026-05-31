// CANDID-024 Step 4 — lib/auth/oauth/unlink.unlinkProvider 단위 테스트.
// prisma($transaction + tx.$queryRaw FOR UPDATE 잠금) mock. 마지막 인증수단 가드가 핵심.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const queryRaw = vi.fn();
  const findUnique = vi.fn();
  const providerFindMany = vi.fn();
  const providerDelete = vi.fn();
  const $transaction = vi.fn();
  return {
    prisma: { $transaction },
    basePrisma: {},
    __mocks: { queryRaw, findUnique, providerFindMany, providerDelete, $transaction },
  };
});

const { __mocks } = (await import('@/lib/prisma')) as unknown as {
  __mocks: {
    queryRaw: Mock;
    findUnique: Mock;
    providerFindMany: Mock;
    providerDelete: Mock;
    $transaction: Mock;
  };
};
const { unlinkProvider } = await import('@/lib/auth/oauth/unlink');
const { AppError } = await import('@/lib/errors');

beforeEach(() => {
  vi.resetAllMocks();
  __mocks.queryRaw.mockResolvedValue([{ id: 42 }]);
  __mocks.providerDelete.mockResolvedValue({});
  __mocks.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      $queryRaw: __mocks.queryRaw,
      user: { findUnique: __mocks.findUnique },
      authProvider: { findMany: __mocks.providerFindMany, delete: __mocks.providerDelete },
    }),
  );
});

const input = { userId: 42, provider: 'google' as const, userAgent: 'vitest-ua', ipAddress: null };

describe('unlinkProvider', () => {
  it('비밀번호 보유 + provider 1개 → 해제 성공 (delete 호출)', async () => {
    __mocks.findUnique.mockResolvedValue({ passwordHash: '$2b$12$X', status: 'ACTIVE' });
    __mocks.providerFindMany.mockResolvedValue([{ provider: 'GOOGLE' }]);

    await unlinkProvider(input);

    expect(__mocks.providerDelete).toHaveBeenCalledWith({
      where: { userId_provider: { userId: 42, provider: 'GOOGLE' } },
    });
    // 행 잠금(FOR UPDATE) 선행.
    expect(__mocks.queryRaw).toHaveBeenCalled();
  });

  it('비밀번호 없음 + provider 2개 → 1개 해제 성공 (잔여 1)', async () => {
    __mocks.findUnique.mockResolvedValue({ passwordHash: null, status: 'ACTIVE' });
    __mocks.providerFindMany.mockResolvedValue([{ provider: 'GOOGLE' }, { provider: 'GITHUB' }]);

    await unlinkProvider(input);

    expect(__mocks.providerDelete).toHaveBeenCalled();
  });

  it('비밀번호 없음 + provider 1개(마지막 인증수단) → USER_LAST_AUTH_METHOD, delete 미호출', async () => {
    __mocks.findUnique.mockResolvedValue({ passwordHash: null, status: 'ACTIVE' });
    __mocks.providerFindMany.mockResolvedValue([{ provider: 'GOOGLE' }]);

    await expect(unlinkProvider(input)).rejects.toMatchObject({ code: 'USER_LAST_AUTH_METHOD' });
    expect(__mocks.providerDelete).not.toHaveBeenCalled();
  });

  it('연결되지 않은 provider → USER_PROVIDER_NOT_LINKED', async () => {
    __mocks.findUnique.mockResolvedValue({ passwordHash: '$2b$12$X', status: 'ACTIVE' });
    __mocks.providerFindMany.mockResolvedValue([{ provider: 'GITHUB' }]); // google 미연결

    await expect(unlinkProvider(input)).rejects.toMatchObject({ code: 'USER_PROVIDER_NOT_LINKED' });
    expect(__mocks.providerDelete).not.toHaveBeenCalled();
  });

  it('사용자 미존재 → USER_NOT_FOUND', async () => {
    __mocks.findUnique.mockResolvedValue(null);

    await expect(unlinkProvider(input)).rejects.toBeInstanceOf(AppError);
    await expect(unlinkProvider(input)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('탈퇴(WITHDRAWN) → USER_NOT_FOUND', async () => {
    __mocks.findUnique.mockResolvedValue({ passwordHash: '$2b$12$X', status: 'WITHDRAWN' });

    await expect(unlinkProvider(input)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
