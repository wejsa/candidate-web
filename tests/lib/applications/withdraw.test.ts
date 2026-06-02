// CANDID-023 Step 2 — withdrawApplication 단위 테스트 (Prisma mock).
//
// 검증 포인트:
//   - 조건부 UPDATE의 where 가드(result=IN_PROGRESS) + data(WITHDRAWN/withdrawnAt/withdrawReason)
//   - affected=0 → APP_NOT_WITHDRAWABLE + AuditLog 미기록
//   - AuditLog metadataJson은 PII-free(hasReason boolean만, 사유 평문 미포함 — BR-PII-02)
//   - now 주입 → withdrawnAt ISO 반환

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationResult, AuditEventType } from '@prisma/client';

vi.mock('@/lib/prisma', () => {
  const updateMany = vi.fn();
  const auditCreate = vi.fn();
  const $transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      application: { updateMany },
      auditLog: { create: auditCreate },
    }),
  );
  return {
    prisma: {
      $transaction,
      __updateMany: updateMany,
      __auditCreate: auditCreate,
    },
  };
});

import { withdrawApplication } from '@/lib/applications/withdraw';
import { prisma } from '@/lib/prisma';

const updateMany = (prisma as unknown as { __updateMany: ReturnType<typeof vi.fn> }).__updateMany;
const auditCreate = (prisma as unknown as { __auditCreate: ReturnType<typeof vi.fn> }).__auditCreate;

const NOW = new Date('2026-06-02T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withdrawApplication', () => {
  it('IN_PROGRESS 지원을 철회한다 — result=WITHDRAWN, withdrawnAt 반환', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    const result = await withdrawApplication({
      userId: 7,
      applicationId: 42,
      reason: '개인 사정으로 철회합니다.',
      now: NOW,
    });

    expect(result).toEqual({
      result: 'WITHDRAWN',
      withdrawnAt: NOW.toISOString(),
    });
  });

  it('조건부 UPDATE는 소유권 + IN_PROGRESS 가드 + 철회 데이터를 적용한다', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await withdrawApplication({ userId: 7, applicationId: 42, reason: '사유', now: NOW });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 42, userId: 7, result: ApplicationResult.IN_PROGRESS },
      data: {
        result: ApplicationResult.WITHDRAWN,
        withdrawnAt: NOW,
        withdrawReason: '사유',
      },
    });
  });

  it('사유 미입력 시 withdrawReason=null + AuditLog hasReason=false', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await withdrawApplication({ userId: 1, applicationId: 9, now: NOW });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ withdrawReason: null }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: 1,
        eventType: AuditEventType.APPLICATION_WITHDRAW,
        resourceType: 'application',
        resourceId: '9',
        ipAddress: null,
        userAgent: null,
        metadataJson: { hasReason: false },
      },
    });
  });

  it('userAgent/ipAddress를 AuditLog에 기록한다 (포렌식)', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await withdrawApplication({
      userId: 1,
      applicationId: 9,
      userAgent: 'Mozilla/5.0',
      ipAddress: null,
      now: NOW,
    });

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userAgent: 'Mozilla/5.0', ipAddress: null }),
      }),
    );
  });

  it('빈 문자열 사유는 hasReason=false로 간주한다', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await withdrawApplication({ userId: 1, applicationId: 9, reason: '', now: NOW });

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadataJson: { hasReason: false } }),
      }),
    );
  });

  it('사유 입력 시 AuditLog hasReason=true (사유 평문은 metadata에 미포함 — BR-PII-02)', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await withdrawApplication({ userId: 3, applicationId: 5, reason: '비공개 사유', now: NOW });

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadataJson: { hasReason: true } }),
      }),
    );
    // 사유 평문이 audit 인자 전체에 누출되지 않음 (BR-PII-02)
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('비공개 사유');
  });

  it('affected=0 (미존재/비소유/종결) → APP_NOT_WITHDRAWABLE, AuditLog 미기록', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      withdrawApplication({ userId: 7, applicationId: 42, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_NOT_WITHDRAWABLE' });

    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('이미 철회된 지원 재철회(멱등) → 두 번째는 APP_NOT_WITHDRAWABLE, audit 미기록', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await withdrawApplication({ userId: 7, applicationId: 42, now: NOW });
    expect(auditCreate).toHaveBeenCalledTimes(1); // 1차만 기록
    await expect(
      withdrawApplication({ userId: 7, applicationId: 42, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_NOT_WITHDRAWABLE' });
    expect(auditCreate).toHaveBeenCalledTimes(1); // 2차(count=0)는 추가 기록 없음
  });

  it('AuditLog 생성 실패 시 에러 전파 — 트랜잭션 롤백 위임(BR-TX-01)', async () => {
    // UPDATE는 성공(count=1)했으나 같은 트랜잭션의 AuditLog가 실패하면 에러가 전파되어
    // Prisma가 UPDATE까지 롤백한다(감사 누락 없는 원자성). passthrough mock 한계상 전파만 박제.
    updateMany.mockResolvedValue({ count: 1 });
    auditCreate.mockRejectedValueOnce(new Error('audit insert failed'));

    await expect(
      withdrawApplication({ userId: 7, applicationId: 42, reason: '사유', now: NOW }),
    ).rejects.toThrow('audit insert failed');

    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
