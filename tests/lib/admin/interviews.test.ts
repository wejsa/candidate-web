import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { icsUidFor } from '@/lib/admin/interviews';

// CANDID-053 Step 7 — 면접 일정 writer 단위 테스트(멱등 upsert/감사 분기/존재·철회 가드/원자성).

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { $transaction: Mock };
};
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { upsertInterviewSchedule } = await import('@/lib/admin/interviews');

interface TxMock {
  application: { findUnique: Mock };
  interviewSchedule: { findUnique: Mock; upsert: Mock };
}
let tx: TxMock;

const SCHEDULED_AT = new Date('2026-07-01T05:00:00Z');

function savedRow(over: Record<string, unknown> = {}) {
  return {
    id: 55,
    stage: 'INTERVIEW_1',
    scheduledAt: SCHEDULED_AT,
    locationOrUrl: 'https://meet.example.com/a',
    status: 'SCHEDULED',
    icsUid: 'iv-10-INTERVIEW_1',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx = {
    application: { findUnique: vi.fn().mockResolvedValue({ id: 10, result: 'IN_PROGRESS' }) },
    interviewSchedule: { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue(savedRow()) },
  };
  prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
  // 기본 resolve — clearAllMocks는 구현(mockRejectedValue)을 리셋하지 않으므로 매 테스트 재설정.
  recordAuditEvent.mockResolvedValue(undefined);
});

function args(over: Record<string, unknown> = {}) {
  return {
    actorUserId: 42,
    applicationId: 10,
    stage: 'INTERVIEW_1' as never,
    scheduledAt: SCHEDULED_AT,
    locationOrUrl: 'https://meet.example.com/a',
    ...over,
  };
}

describe('upsertInterviewSchedule', () => {
  it('icsUidFor: (지원서,단계)당 결정적 — 멱등 키', () => {
    expect(icsUidFor(10, 'INTERVIEW_1' as never)).toBe('iv-10-INTERVIEW_1');
    expect(icsUidFor(10, 'INTERVIEW_2' as never)).toBe('iv-10-INTERVIEW_2');
  });

  it('신규 등록 → created=true + INTERVIEW_SCHEDULED 감사(단일 tx로 기록)', async () => {
    tx.interviewSchedule.findUnique.mockResolvedValue(null);
    const res = await upsertInterviewSchedule(args());
    expect(res.created).toBe(true);
    expect(res.icsUid).toBe('iv-10-INTERVIEW_1');
    const upsertArg = tx.interviewSchedule.upsert.mock.calls[0]![0];
    expect(upsertArg.where).toEqual({ icsUid: 'iv-10-INTERVIEW_1' });
    expect(upsertArg.create).toMatchObject({
      applicationId: 10,
      stage: 'INTERVIEW_1',
      status: 'SCHEDULED',
    });
    const [auditInput, auditOpts] = recordAuditEvent.mock.calls[0]!;
    expect(auditInput.eventType).toBe('INTERVIEW_SCHEDULED');
    expect(auditInput.resourceType).toBe('interview_schedule');
    expect(auditInput.metadata).toEqual({
      applicationId: 10,
      stage: 'INTERVIEW_1',
      status: 'SCHEDULED',
    });
    // BR-TX-01 — 감사는 같은 트랜잭션(tx)으로 기록(밖으로 새면 부분커밋).
    expect(auditOpts).toEqual({ tx });
  });

  it.each(['INTERVIEW_1', 'INTERVIEW_2'])(
    '%s 등록 → 단계별 결정적 icsUid로 where/create 전파',
    async (stage) => {
      tx.interviewSchedule.findUnique.mockResolvedValue(null);
      tx.interviewSchedule.upsert.mockResolvedValue(savedRow({ stage, icsUid: `iv-10-${stage}` }));
      const res = await upsertInterviewSchedule(args({ stage: stage as never }));
      expect(res.icsUid).toBe(`iv-10-${stage}`);
      expect(tx.interviewSchedule.upsert.mock.calls[0]![0].where).toEqual({
        icsUid: `iv-10-${stage}`,
      });
      expect(recordAuditEvent.mock.calls[0]![0].metadata.stage).toBe(stage);
    },
  );

  it('기존 일정 재등록(멱등) → created=false + INTERVIEW_UPDATED, update에 결정 키+갱신 필드', async () => {
    tx.interviewSchedule.findUnique.mockResolvedValue({ id: 55 });
    const res = await upsertInterviewSchedule(args({ locationOrUrl: 'https://new.example.com/b' }));
    expect(res.created).toBe(false);
    expect(recordAuditEvent.mock.calls[0]![0].eventType).toBe('INTERVIEW_UPDATED');
    const upsertArg = tx.interviewSchedule.upsert.mock.calls[0]![0];
    expect(upsertArg.where).toEqual({ icsUid: 'iv-10-INTERVIEW_1' }); // 멱등 키 동일
    expect(upsertArg.update).toMatchObject({
      status: 'SCHEDULED',
      locationOrUrl: 'https://new.example.com/b',
    });
  });

  it('미존재 지원서 → APP_NOT_FOUND (일정 미생성)', async () => {
    tx.application.findUnique.mockResolvedValue(null);
    await expect(upsertInterviewSchedule(args())).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
    expect(tx.interviewSchedule.upsert).not.toHaveBeenCalled();
  });

  it('철회(WITHDRAWN) 지원서 → 면접 등록 거부(Step 6 가드와 정합)', async () => {
    tx.application.findUnique.mockResolvedValue({ id: 10, result: 'WITHDRAWN' });
    await expect(upsertInterviewSchedule(args())).rejects.toMatchObject({
      code: 'APP_INVALID_STAGE_TRANSITION',
    });
    expect(tx.interviewSchedule.upsert).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('감사 실패 → 전체 reject(트랜잭션 롤백 위임, BR-TX-01)', async () => {
    tx.interviewSchedule.findUnique.mockResolvedValue(null);
    recordAuditEvent.mockRejectedValue(new Error('audit down'));
    await expect(upsertInterviewSchedule(args())).rejects.toThrow('audit down');
  });

  it('감사 metadata는 PII-free (enum/id만)', async () => {
    tx.interviewSchedule.findUnique.mockResolvedValue(null);
    await upsertInterviewSchedule(args());
    const meta = recordAuditEvent.mock.calls[0]![0].metadata;
    expect(JSON.stringify(meta)).not.toMatch(/meet\.example|@|https/);
  });
});
