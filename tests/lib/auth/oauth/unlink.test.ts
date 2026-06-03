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

vi.mock('@/lib/audit/record', () => ({ recordAuditEventSafe: vi.fn() }));

const { __mocks } = (await import('@/lib/prisma')) as unknown as {
  __mocks: {
    queryRaw: Mock;
    findUnique: Mock;
    providerFindMany: Mock;
    providerDelete: Mock;
    $transaction: Mock;
  };
};
const { recordAuditEventSafe } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEventSafe: Mock;
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

    // CANDID-026 Step 4 — 해제 성공 후 OAUTH_UNLINKED 감사(provider metadata, PII-free).
    expect(recordAuditEventSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OAUTH_UNLINKED',
        actorUserId: 42,
        resourceType: 'user',
        resourceId: '42',
        metadata: { provider: 'google' },
      }),
    );

    expect(__mocks.providerDelete).toHaveBeenCalledWith({
      where: { userId_provider: { userId: 42, provider: 'GOOGLE' } },
    });
    // QA M1: 행 잠금(FOR UPDATE)이 검증(findUnique)·삭제보다 *먼저* 실행됨을 순서로 단언 (TOCTOU 가드).
    expect(__mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      __mocks.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(__mocks.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      __mocks.providerDelete.mock.invocationCallOrder[0]!,
    );
  });

  // QA m1: github(GITHUB enum) 매핑 + delete where 계약.
  it('github 해제 — GITHUB enum으로 delete 호출', async () => {
    __mocks.findUnique.mockResolvedValue({ passwordHash: '$2b$12$X', status: 'ACTIVE' });
    __mocks.providerFindMany.mockResolvedValue([{ provider: 'GITHUB' }]);

    await unlinkProvider({ ...input, provider: 'github' });

    expect(__mocks.providerDelete).toHaveBeenCalledWith({
      where: { userId_provider: { userId: 42, provider: 'GITHUB' } },
    });
  });

  // QA M2: delete 실패(동시 해제 race 등) → 트랜잭션 전체 reject 전파 (부분 커밋 방지 의도).
  it('delete 실패 → 예외 전파', async () => {
    __mocks.findUnique.mockResolvedValue({ passwordHash: '$2b$12$X', status: 'ACTIVE' });
    __mocks.providerFindMany.mockResolvedValue([{ provider: 'GOOGLE' }]);
    __mocks.providerDelete.mockRejectedValue(new Error('P2025 record not found'));

    await expect(unlinkProvider(input)).rejects.toThrow();
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
    // 리뷰 보강(PR #118) — 해제 거부 시 OAUTH_UNLINKED 미발행(트랜잭션 내 throw → tx 밖 emit 도달 불가).
    expect(recordAuditEventSafe).not.toHaveBeenCalled();
  });

  // 리뷰 MAJOR(test): 마지막 인증수단 거부 경계 명시 — 무비번 + 대상 provider만(비대상 0) → 거부.
  it('무비번 + 대상 provider만(비대상 0) → USER_LAST_AUTH_METHOD', async () => {
    __mocks.findUnique.mockResolvedValue({ passwordHash: null, status: 'ACTIVE' });
    __mocks.providerFindMany.mockResolvedValue([{ provider: 'GOOGLE' }]); // 대상=google, 비대상 0

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
