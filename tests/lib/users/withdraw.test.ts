// CANDID-022 Step 2 — withdrawUser 단위 테스트.
// Prisma + verifyPassword + revokeAllForUser + encryptUserPiiInput 모두 mock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const tx = {
    application: { count: vi.fn() },
    user: { update: vi.fn(), delete: vi.fn() },
    resumeFile: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    prisma: {
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      __tx: tx,
    },
  };
});
vi.mock('@/lib/auth/password', () => ({ verifyPassword: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ revokeAllForUser: vi.fn() }));
vi.mock('@/lib/prisma/extends', () => ({
  encryptUserPiiInput: vi.fn((input: Record<string, unknown>) => ({
    ...('phone' in input ? { phone: null, phoneKeyVersion: null } : {}),
    ...('birthDate' in input ? { birthDate: null, birthDateKeyVersion: null } : {}),
  })),
}));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: {
    user: { findUnique: Mock };
    $transaction: Mock;
    __tx: {
      application: { count: Mock };
      user: { update: Mock; delete: Mock };
      resumeFile: { deleteMany: Mock };
      auditLog: { create: Mock };
    };
  };
};
const { verifyPassword } = (await import('@/lib/auth/password')) as unknown as {
  verifyPassword: Mock;
};
const { revokeAllForUser } = (await import('@/lib/auth/session')) as unknown as {
  revokeAllForUser: Mock;
};
const { withdrawUser, buildAnonymizedEmail } = await import('@/lib/users/withdraw');

const baseUser = {
  id: 42,
  passwordHash: '$2b$12$hash',
  anonymizedAt: null,
  status: 'ACTIVE' as const,
};

beforeEach(() => {
  prisma.user.findUnique.mockReset();
  prisma.__tx.application.count.mockReset();
  prisma.__tx.user.update.mockReset();
  prisma.__tx.user.delete.mockReset();
  prisma.__tx.resumeFile.deleteMany.mockReset();
  prisma.__tx.auditLog.create.mockReset();
  verifyPassword.mockReset();
  revokeAllForUser.mockReset();
  revokeAllForUser.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withdrawUser — 인증/상태 가드', () => {
  it('사용자 미존재 → USER_NOT_FOUND', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(withdrawUser({ userId: 42 })).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  it('anonymizedAt NOT NULL → USER_ALREADY_WITHDRAWN (멱등)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      anonymizedAt: new Date('2026-05-01T00:00:00Z'),
    });
    await expect(withdrawUser({ userId: 42, passwordConfirmation: 'pw' })).rejects.toMatchObject({
      code: 'USER_ALREADY_WITHDRAWN',
    });
  });

  it('status === WITHDRAWN → USER_ALREADY_WITHDRAWN (anonymizedAt 미설정 레거시 row 가드)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, status: 'WITHDRAWN' });
    await expect(withdrawUser({ userId: 42, passwordConfirmation: 'pw' })).rejects.toMatchObject({
      code: 'USER_ALREADY_WITHDRAWN',
    });
  });

  it('passwordHash NULL (소셜 전용) → USER_REAUTH_REQUIRED', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash: null });
    await expect(withdrawUser({ userId: 42 })).rejects.toMatchObject({
      code: 'USER_REAUTH_REQUIRED',
    });
  });

  it('passwordHash NOT NULL + passwordConfirmation 누락 → USER_PASSWORD_RECONFIRM_REQUIRED', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser);
    await expect(withdrawUser({ userId: 42 })).rejects.toMatchObject({
      code: 'USER_PASSWORD_RECONFIRM_REQUIRED',
    });
    await expect(
      withdrawUser({ userId: 42, passwordConfirmation: '' }),
    ).rejects.toMatchObject({ code: 'USER_PASSWORD_RECONFIRM_REQUIRED' });
  });

  it('비밀번호 불일치 → AUTH_INVALID_CREDENTIALS', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser);
    verifyPassword.mockResolvedValue(false);
    await expect(
      withdrawUser({ userId: 42, passwordConfirmation: 'wrong' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    expect(verifyPassword).toHaveBeenCalledWith('wrong', baseUser.passwordHash);
  });
});

describe('withdrawUser — 분기 (applications count)', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(baseUser);
    verifyPassword.mockResolvedValue(true);
    prisma.__tx.user.update.mockResolvedValue({});
    prisma.__tx.user.delete.mockResolvedValue({});
    prisma.__tx.resumeFile.deleteMany.mockResolvedValue({ count: 0 });
    prisma.__tx.auditLog.create.mockResolvedValue({});
  });

  it('applications > 0 → mode=anonymized + user.update + audit × 2 (USER_WITHDRAWN + USER_ANONYMIZED)', async () => {
    prisma.__tx.application.count.mockResolvedValue(3);
    const result = await withdrawUser({
      userId: 42,
      passwordConfirmation: 'pw',
      reason: '취업 결정',
      userAgent: 'test-ua',
      ipAddress: '203.0.113.10',
    });

    expect(result.mode).toBe('anonymized');
    expect(result.userId).toBe(42);
    expect(prisma.__tx.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.__tx.user.delete).not.toHaveBeenCalled();
    expect(prisma.__tx.resumeFile.deleteMany).not.toHaveBeenCalled();

    const auditCalls = prisma.__tx.auditLog.create.mock.calls;
    expect(auditCalls).toHaveLength(2);
    const events = auditCalls.map((c) => (c[0] as { data: { eventType: string } }).data.eventType);
    expect(events).toEqual(['USER_WITHDRAWN', 'USER_ANONYMIZED']);
  });

  it('applications === 0 → mode=hard_deleted + ResumeFile orphan deleteMany + user.delete + audit × 2', async () => {
    prisma.__tx.application.count.mockResolvedValue(0);
    const result = await withdrawUser({ userId: 42, passwordConfirmation: 'pw' });

    expect(result.mode).toBe('hard_deleted');
    expect(prisma.__tx.resumeFile.deleteMany).toHaveBeenCalledWith({
      where: { ownerUserId: 42, applicationId: null, draftId: null },
    });
    expect(prisma.__tx.user.delete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(prisma.__tx.user.update).not.toHaveBeenCalled();

    const events = prisma.__tx.auditLog.create.mock.calls.map(
      (c) => (c[0] as { data: { eventType: string } }).data.eventType,
    );
    expect(events).toEqual(['USER_WITHDRAWN', 'USER_HARD_DELETED']);
  });

  it('user.delete가 audit emit 후에 호출됨 (actorUserId 박제 보장)', async () => {
    prisma.__tx.application.count.mockResolvedValue(0);
    const order: string[] = [];
    prisma.__tx.auditLog.create.mockImplementation(async () => {
      order.push('audit');
      return {};
    });
    prisma.__tx.user.delete.mockImplementation(async () => {
      order.push('delete');
      return {};
    });
    await withdrawUser({ userId: 42, passwordConfirmation: 'pw' });
    expect(order).toEqual(['audit', 'audit', 'delete']);
  });
});

describe('withdrawUser — 익명화 매트릭스 (BR-PII-03)', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(baseUser);
    verifyPassword.mockResolvedValue(true);
    prisma.__tx.application.count.mockResolvedValue(1);
    prisma.__tx.user.update.mockResolvedValue({});
    prisma.__tx.auditLog.create.mockResolvedValue({});
  });

  it('익명화 페이로드: email rotate + name="탈퇴회원" + PII NULL + passwordHash NULL + status WITHDRAWN + withdrawnAt/anonymizedAt + 카운터 리셋', async () => {
    await withdrawUser({ userId: 42, passwordConfirmation: 'pw' });
    const call = prisma.__tx.user.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    const data = call[0].data;
    expect(data.email).toMatch(/^withdrawn\+42\+[0-9a-f]{16}@anonymized\.invalid$/);
    expect(data.name).toBe('탈퇴회원');
    expect(data.passwordHash).toBeNull();
    expect(data.status).toBe('WITHDRAWN');
    expect(data.failedLoginCount).toBe(0);
    expect(data.lockedUntil).toBeNull();
    expect(data.phone).toBeNull();
    expect(data.phoneKeyVersion).toBeNull();
    expect(data.birthDate).toBeNull();
    expect(data.birthDateKeyVersion).toBeNull();
    expect(data.withdrawnAt).toBeInstanceOf(Date);
    expect(data.anonymizedAt).toBeInstanceOf(Date);
    expect(data.withdrawnAt).toEqual(data.anonymizedAt);
  });

  it('buildAnonymizedEmail은 호출마다 다른 hex를 사용 (UNIQUE 충돌 회피)', () => {
    const a = buildAnonymizedEmail(42);
    const b = buildAnonymizedEmail(42);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^withdrawn\+42\+[0-9a-f]{16}@anonymized\.invalid$/);
    expect(b).toMatch(/^withdrawn\+42\+[0-9a-f]{16}@anonymized\.invalid$/);
  });
});

describe('withdrawUser — AuditLog 회귀 가드 (BR-PII-02)', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(baseUser);
    verifyPassword.mockResolvedValue(true);
    prisma.__tx.user.update.mockResolvedValue({});
    prisma.__tx.user.delete.mockResolvedValue({});
    prisma.__tx.resumeFile.deleteMany.mockResolvedValue({ count: 0 });
    prisma.__tx.auditLog.create.mockResolvedValue({});
  });

  it('metadataJson은 reasonLength만 기록 — 평문 reason 미포함 (PII-free)', async () => {
    prisma.__tx.application.count.mockResolvedValue(1);
    await withdrawUser({
      userId: 42,
      passwordConfirmation: 'pw',
      reason: '평문 사유 노출 금지',
    });
    for (const call of prisma.__tx.auditLog.create.mock.calls) {
      const data = (call[0] as { data: { metadataJson: Record<string, unknown> } }).data;
      const metadata = data.metadataJson;
      const json = JSON.stringify(metadata);
      expect(json).not.toContain('평문 사유 노출 금지');
      expect(metadata).toHaveProperty('reasonLength');
      expect(typeof metadata.reasonLength).toBe('number');
    }
  });

  it('reason 미전달 시 reasonLength=0', async () => {
    prisma.__tx.application.count.mockResolvedValue(0);
    await withdrawUser({ userId: 42, passwordConfirmation: 'pw' });
    const firstCall = prisma.__tx.auditLog.create.mock.calls[0] as [
      { data: { metadataJson: Record<string, unknown> } },
    ];
    expect(firstCall[0].data.metadataJson.reasonLength).toBe(0);
  });

  it('actorUserId / resourceType=user / resourceId=userId 박제', async () => {
    prisma.__tx.application.count.mockResolvedValue(1);
    await withdrawUser({ userId: 42, passwordConfirmation: 'pw' });
    for (const call of prisma.__tx.auditLog.create.mock.calls) {
      const data = (
        call[0] as {
          data: { actorUserId: number; resourceType: string; resourceId: string };
        }
      ).data;
      expect(data.actorUserId).toBe(42);
      expect(data.resourceType).toBe('user');
      expect(data.resourceId).toBe('42');
    }
  });

  it('userAgent / ipAddress 전달 시 audit row에 박제 (감사 정합)', async () => {
    prisma.__tx.application.count.mockResolvedValue(1);
    await withdrawUser({
      userId: 42,
      passwordConfirmation: 'pw',
      userAgent: 'Mozilla/5.0',
      ipAddress: '203.0.113.42',
    });
    const data = (
      prisma.__tx.auditLog.create.mock.calls[0] as [
        { data: { userAgent: string | null; ipAddress: string | null } },
      ]
    )[0].data;
    expect(data.userAgent).toBe('Mozilla/5.0');
    expect(data.ipAddress).toBe('203.0.113.42');
  });
});

describe('withdrawUser — RefreshToken revoke (BR-AUTH-05)', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(baseUser);
    verifyPassword.mockResolvedValue(true);
    prisma.__tx.user.update.mockResolvedValue({});
    prisma.__tx.user.delete.mockResolvedValue({});
    prisma.__tx.resumeFile.deleteMany.mockResolvedValue({ count: 0 });
    prisma.__tx.auditLog.create.mockResolvedValue({});
  });

  it('anonymize 경로에서 revokeAllForUser(userId, "user_withdrawn") 호출 + 반환 count 전파', async () => {
    prisma.__tx.application.count.mockResolvedValue(2);
    revokeAllForUser.mockResolvedValue(3);
    const result = await withdrawUser({ userId: 42, passwordConfirmation: 'pw' });
    expect(revokeAllForUser).toHaveBeenCalledWith(42, 'user_withdrawn');
    expect(result.revokedSessionCount).toBe(3);
  });

  it('revokeAllForUser 실패는 결과 응답 차단하지 않음 (revokedSessionCount=0)', async () => {
    prisma.__tx.application.count.mockResolvedValue(1);
    revokeAllForUser.mockRejectedValue(new Error('redis down'));
    const result = await withdrawUser({ userId: 42, passwordConfirmation: 'pw' });
    expect(result.mode).toBe('anonymized');
    expect(result.revokedSessionCount).toBe(0);
  });
});
