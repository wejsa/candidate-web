// CANDID-053 Step 3 — changeUserRole 서비스 단위 테스트.
// prisma.$transaction과 recordAuditEvent를 mock하여 가드/멱등/감사 분기를 검증한다.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { $transaction: Mock };
};
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { changeUserRole } = await import('@/lib/admin/roles');

interface TxMock {
  $queryRaw: Mock;
  user: { findUnique: Mock; update: Mock };
}

function makeTx(): TxMock {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  };
}

let tx: TxMock;
beforeEach(() => {
  vi.resetAllMocks();
  tx = makeTx();
  // $transaction(cb, opts) → cb(tx) 실행을 모사.
  prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
});

describe('changeUserRole', () => {
  it('본인 역할 변경 → USER_CANNOT_CHANGE_OWN_ROLE (트랜잭션 미진입)', async () => {
    await expect(
      changeUserRole({ actorUserId: 5, targetUserId: 5, newRole: 'ADMIN' }),
    ).rejects.toMatchObject({ code: 'USER_CANNOT_CHANGE_OWN_ROLE' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('대상 미존재 → USER_NOT_FOUND', async () => {
    tx.user.findUnique.mockResolvedValue(null);
    await expect(
      changeUserRole({ actorUserId: 1, targetUserId: 9, newRole: 'RECRUITER' }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('대상이 WITHDRAWN → USER_NOT_FOUND (정보 노출 차단)', async () => {
    tx.user.findUnique.mockResolvedValue({ role: 'RECRUITER', status: 'WITHDRAWN' });
    await expect(
      changeUserRole({ actorUserId: 1, targetUserId: 9, newRole: 'ADMIN' }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('RECRUITER→ADMIN 승격 → ROLE_GRANTED (강등 아님, last-ADMIN 가드 미진입)', async () => {
    tx.user.findUnique.mockResolvedValue({ role: 'RECRUITER', status: 'ACTIVE' });
    const r = await changeUserRole({ actorUserId: 1, targetUserId: 9, newRole: 'ADMIN' });
    expect(r).toMatchObject({ role: 'ADMIN', previousRole: 'RECRUITER', changed: true });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ROLE_GRANTED' }),
      expect.anything(),
    );
  });

  it('승격(CANDIDATE→RECRUITER) → update + ROLE_GRANTED 감사', async () => {
    tx.user.findUnique.mockResolvedValue({ role: 'CANDIDATE', status: 'ACTIVE' });
    const r = await changeUserRole({ actorUserId: 1, targetUserId: 9, newRole: 'RECRUITER' });
    expect(r).toMatchObject({ role: 'RECRUITER', previousRole: 'CANDIDATE', changed: true });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { role: 'RECRUITER' } });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ROLE_GRANTED', metadata: { from: 'CANDIDATE', to: 'RECRUITER' } }),
      expect.objectContaining({ tx }),
    );
  });

  it('멱등(동일 role) → update/감사 없음, changed=false', async () => {
    tx.user.findUnique.mockResolvedValue({ role: 'RECRUITER', status: 'ACTIVE' });
    const r = await changeUserRole({ actorUserId: 1, targetUserId: 9, newRole: 'RECRUITER' });
    expect(r.changed).toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('마지막 ADMIN 강등 → USER_LAST_ADMIN (대상 외 활성 ADMIN 0)', async () => {
    tx.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' });
    // 강등 경로 $queryRaw=활성 ADMIN 집합(id ASC FOR UPDATE) → 대상 본인만 = 다른 ADMIN 0.
    tx.$queryRaw.mockResolvedValue([{ id: 9 }]);
    await expect(
      changeUserRole({ actorUserId: 1, targetUserId: 9, newRole: 'CANDIDATE' }),
    ).rejects.toMatchObject({ code: 'USER_LAST_ADMIN' });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('ADMIN 강등 허용(다른 활성 ADMIN 존재) → ROLE_REVOKED 감사', async () => {
    tx.user.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' });
    tx.$queryRaw.mockResolvedValue([{ id: 9 }, { id: 2 }]);
    const r = await changeUserRole({ actorUserId: 1, targetUserId: 9, newRole: 'RECRUITER' });
    expect(r).toMatchObject({ role: 'RECRUITER', changed: true });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ROLE_REVOKED' }),
      expect.anything(),
    );
  });
});
