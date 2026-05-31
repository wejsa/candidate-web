// CANDID-024 Step 3 — lib/users/password-change.changePassword 단위 테스트.
// prisma($transaction 포함) + password 헬퍼 mock. 트랜잭션 콜백은 tx 더블로 즉시 실행.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const findUnique = vi.fn();
  const userUpdateMany = vi.fn();
  const refreshUpdateMany = vi.fn();
  const auditCreate = vi.fn();
  const $transaction = vi.fn();
  return {
    prisma: { user: { findUnique }, $transaction },
    basePrisma: {},
    __mocks: { findUnique, userUpdateMany, refreshUpdateMany, auditCreate, $transaction },
  };
});
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));

const { __mocks } = (await import('@/lib/prisma')) as unknown as {
  __mocks: {
    findUnique: Mock;
    userUpdateMany: Mock;
    refreshUpdateMany: Mock;
    auditCreate: Mock;
    $transaction: Mock;
  };
};
const { hashPassword, verifyPassword } = (await import('@/lib/auth/password')) as unknown as {
  hashPassword: Mock;
  verifyPassword: Mock;
};
const { changePassword } = await import('@/lib/users/password-change');
const { AppError } = await import('@/lib/errors');

beforeEach(() => {
  vi.resetAllMocks();
  __mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  __mocks.refreshUpdateMany.mockResolvedValue({ count: 2 });
  __mocks.auditCreate.mockResolvedValue({});
  hashPassword.mockResolvedValue('$2b$12$NEWHASH');
  // resetAllMocks가 구현을 지우므로 tx 콜백 실행 구현을 매 테스트 재설정 (tx 더블은 inner mock 참조).
  __mocks.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      user: { updateMany: __mocks.userUpdateMany },
      refreshToken: { updateMany: __mocks.refreshUpdateMany },
      auditLog: { create: __mocks.auditCreate },
    }),
  );
});

const input = {
  userId: 42,
  currentPassword: 'OldPass123!',
  newPassword: 'NewPass456!',
  userAgent: 'vitest-ua',
  ipAddress: null,
};

describe('changePassword — 비번 보유 사용자(changed)', () => {
  beforeEach(() => {
    __mocks.findUnique.mockResolvedValue({ id: 42, passwordHash: '$2b$12$OLD', status: 'ACTIVE' });
    verifyPassword.mockResolvedValue(true);
  });

  it('현재 비번 일치 → 해싱·갱신·전체 revoke·감사 로그(PASSWORD_CHANGE)', async () => {
    const result = await changePassword(input);

    expect(result).toEqual({ mode: 'changed', revokedSessionCount: 2 });
    expect(hashPassword).toHaveBeenCalledWith('NewPass456!');
    // 비번 갱신 (status≠WITHDRAWN 가드).
    expect(__mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 42, NOT: { status: 'WITHDRAWN' } },
      data: { passwordHash: '$2b$12$NEWHASH' },
    });
    // 전체 refresh 토큰 revoke (BR-AUTH-05).
    expect(__mocks.refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: 42, revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'password_change' },
    });
    // 감사 로그 — 평문 비밀번호 비포함.
    const audit = __mocks.auditCreate.mock.calls[0]![0].data;
    expect(audit.eventType).toBe('PASSWORD_CHANGE');
    expect(audit.actorUserId).toBe(42);
    expect(JSON.stringify(audit)).not.toContain('NewPass456!');
    expect(JSON.stringify(audit)).not.toContain('OldPass123!');
  });

  it('현재 비번 불일치 → AUTH_INVALID_CREDENTIALS, 갱신 미수행', async () => {
    verifyPassword.mockResolvedValue(false);

    await expect(changePassword(input)).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(__mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it('현재 비번 누락 → USER_PASSWORD_RECONFIRM_REQUIRED', async () => {
    await expect(changePassword({ ...input, currentPassword: undefined })).rejects.toMatchObject({
      code: 'USER_PASSWORD_RECONFIRM_REQUIRED',
    });
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});

describe('changePassword — 소셜 전용(set)', () => {
  it('passwordHash=null → 현재 비번 없이 최초 설정', async () => {
    __mocks.findUnique.mockResolvedValue({ id: 42, passwordHash: null, status: 'ACTIVE' });

    const result = await changePassword({ ...input, currentPassword: undefined });

    expect(result.mode).toBe('set');
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(hashPassword).toHaveBeenCalledWith('NewPass456!');
    expect(__mocks.userUpdateMany).toHaveBeenCalled();
  });
});

describe('changePassword — 계정 상태', () => {
  it('미존재 → USER_NOT_FOUND', async () => {
    __mocks.findUnique.mockResolvedValue(null);
    await expect(changePassword(input)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('탈퇴(WITHDRAWN) → USER_NOT_FOUND', async () => {
    __mocks.findUnique.mockResolvedValue({
      id: 42,
      passwordHash: '$2b$12$OLD',
      status: 'WITHDRAWN',
    });
    await expect(changePassword(input)).rejects.toBeInstanceOf(AppError);
  });

  it('tx 중 동시 탈퇴(updateMany count 0) → USER_NOT_FOUND', async () => {
    __mocks.findUnique.mockResolvedValue({ id: 42, passwordHash: '$2b$12$OLD', status: 'ACTIVE' });
    verifyPassword.mockResolvedValue(true);
    __mocks.userUpdateMany.mockResolvedValue({ count: 0 });

    await expect(changePassword(input)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
