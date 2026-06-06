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

  // 합법 전이 그래프 전수 검증(11 간선) + 결과 파생 — 그래프 상수 오편집 회귀 차단(it.each table-driven).
  it.each([
    ['SUBMITTED', 'DOC_REVIEW', 'IN_PROGRESS'],
    ['SUBMITTED', 'REJECTED', 'FAILED'],
    ['DOC_REVIEW', 'INTERVIEW_1', 'IN_PROGRESS'],
    ['DOC_REVIEW', 'REJECTED', 'FAILED'],
    ['INTERVIEW_1', 'INTERVIEW_2', 'IN_PROGRESS'],
    ['INTERVIEW_1', 'OFFER', 'IN_PROGRESS'], // 2차 면접 생략 허용
    ['INTERVIEW_1', 'REJECTED', 'FAILED'],
    ['INTERVIEW_2', 'OFFER', 'IN_PROGRESS'],
    ['INTERVIEW_2', 'REJECTED', 'FAILED'],
    ['OFFER', 'HIRED', 'PASSED'],
    ['OFFER', 'REJECTED', 'FAILED'],
  ])('합법 전이 %s → %s ⇒ result=%s', async (from, to, expected) => {
    lockReturns(from);
    const res = await transitionApplicationStage({
      actorUserId: 1,
      applicationId: 10,
      toStage: to as never,
    });
    expect(res).toMatchObject({ fromStage: from, toStage: to, result: expected });
    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { currentStage: to, result: expected },
    });
  });

  it('동일 단계 self-transition(DOC_REVIEW→DOC_REVIEW) → 거부(422)', async () => {
    lockReturns('DOC_REVIEW');
    await expect(
      transitionApplicationStage({
        actorUserId: 1,
        applicationId: 10,
        toStage: 'DOC_REVIEW' as never,
      }),
    ).rejects.toMatchObject({ code: 'APP_INVALID_STAGE_TRANSITION' });
    expect(tx.applicationStatusHistory.create).not.toHaveBeenCalled();
  });

  it('tx 중간 실패(이력 create reject) → 에러 전파 + 감사 미발행(부분 커밋 없음, BR-TX-01)', async () => {
    lockReturns('SUBMITTED');
    tx.applicationStatusHistory.create.mockRejectedValue(new Error('db down'));
    await expect(
      transitionApplicationStage({
        actorUserId: 1,
        applicationId: 10,
        toStage: 'DOC_REVIEW' as never,
      }),
    ).rejects.toThrow('db down');
    expect(recordAuditEvent).not.toHaveBeenCalled();
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
