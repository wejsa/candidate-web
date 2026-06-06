import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// CANDID-053 Step 6 — 전형 단계 전이 서비스 단위 테스트(그래프/결과/이력/감사/락).

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { $transaction: Mock };
};
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { transitionApplicationStage } = await import('@/lib/admin/stage-transition');

interface TxMock {
  $queryRaw: Mock;
  application: { update: Mock };
  applicationStatusHistory: { create: Mock };
}
let tx: TxMock;

beforeEach(() => {
  vi.clearAllMocks();
  tx = {
    $queryRaw: vi.fn(),
    application: { update: vi.fn().mockResolvedValue({}) },
    applicationStatusHistory: { create: vi.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
});

function lockReturns(current_stage: string, result = 'IN_PROGRESS') {
  tx.$queryRaw.mockResolvedValue([{ current_stage, result }]);
}

describe('transitionApplicationStage', () => {
  it('SUBMITTED → DOC_REVIEW: 정상 전이 + 이력(changedByUserId) + 감사', async () => {
    lockReturns('SUBMITTED');
    const res = await transitionApplicationStage({
      actorUserId: 42,
      applicationId: 10,
      toStage: 'DOC_REVIEW' as never,
    });
    expect(res).toMatchObject({
      fromStage: 'SUBMITTED',
      toStage: 'DOC_REVIEW',
      result: 'IN_PROGRESS',
    });
    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { currentStage: 'DOC_REVIEW', result: 'IN_PROGRESS' },
    });
    expect(tx.applicationStatusHistory.create).toHaveBeenCalledWith({
      data: {
        applicationId: 10,
        fromStage: 'SUBMITTED',
        toStage: 'DOC_REVIEW',
        changedByUserId: 42,
      },
    });
    const audited = recordAuditEvent.mock.calls[0]![0];
    expect(audited.eventType).toBe('APPLICATION_STAGE_CHANGED');
    expect(audited.metadata).toEqual({
      from: 'SUBMITTED',
      to: 'DOC_REVIEW',
      result: 'IN_PROGRESS',
    });
  });

  it('OFFER → HIRED: result=PASSED 파생', async () => {
    lockReturns('OFFER');
    const res = await transitionApplicationStage({
      actorUserId: 1,
      applicationId: 10,
      toStage: 'HIRED' as never,
    });
    expect(res.result).toBe('PASSED');
    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { currentStage: 'HIRED', result: 'PASSED' },
    });
  });

  it('INTERVIEW_1 → REJECTED: result=FAILED 파생', async () => {
    lockReturns('INTERVIEW_1');
    const res = await transitionApplicationStage({
      actorUserId: 1,
      applicationId: 10,
      toStage: 'REJECTED' as never,
    });
    expect(res.result).toBe('FAILED');
  });

  it('SUBMITTED → HIRED: 점프 전이 거부(422) — 변경/이력/감사 없음', async () => {
    lockReturns('SUBMITTED');
    await expect(
      transitionApplicationStage({ actorUserId: 1, applicationId: 10, toStage: 'HIRED' as never }),
    ).rejects.toMatchObject({ code: 'APP_INVALID_STAGE_TRANSITION' });
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.applicationStatusHistory.create).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('HIRED(종단) → DOC_REVIEW: 역행 거부(422)', async () => {
    lockReturns('HIRED', 'PASSED');
    await expect(
      transitionApplicationStage({
        actorUserId: 1,
        applicationId: 10,
        toStage: 'DOC_REVIEW' as never,
      }),
    ).rejects.toMatchObject({ code: 'APP_INVALID_STAGE_TRANSITION' });
  });

  it('철회(result=WITHDRAWN) 지원서 → 전이 불가(422)', async () => {
    lockReturns('DOC_REVIEW', 'WITHDRAWN');
    await expect(
      transitionApplicationStage({
        actorUserId: 1,
        applicationId: 10,
        toStage: 'INTERVIEW_1' as never,
      }),
    ).rejects.toMatchObject({ code: 'APP_INVALID_STAGE_TRANSITION' });
    expect(tx.application.update).not.toHaveBeenCalled();
  });

  it('미존재 지원서(잠금 행 없음) → APP_NOT_FOUND', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      transitionApplicationStage({
        actorUserId: 1,
        applicationId: 999,
        toStage: 'DOC_REVIEW' as never,
      }),
    ).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });
});
