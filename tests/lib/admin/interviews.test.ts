import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { icsUidFor } from '@/lib/admin/interviews';

// CANDID-053 Step 7 — 면접 일정 writer 단위 테스트(멱등 upsert/감사 분기/존재검증).

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn() },
  basePrisma: { application: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));

const { prisma, basePrisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { $transaction: Mock };
  basePrisma: { application: { findUnique: Mock } };
};
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { upsertInterviewSchedule } = await import('@/lib/admin/interviews');

interface TxMock {
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
    interviewSchedule: { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue(savedRow()) },
  };
  prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
  basePrisma.application.findUnique.mockResolvedValue({ id: 10 });
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

  it('신규 등록 → created=true + INTERVIEW_SCHEDULED 감사, upsert는 결정적 icsUid로', async () => {
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
    const audited = recordAuditEvent.mock.calls[0]![0];
    expect(audited.eventType).toBe('INTERVIEW_SCHEDULED');
    expect(audited.resourceType).toBe('interview_schedule');
    expect(audited.metadata).toEqual({
      applicationId: 10,
      stage: 'INTERVIEW_1',
      status: 'SCHEDULED',
    });
  });

  it('기존 일정 재등록(멱등) → created=false + INTERVIEW_UPDATED 감사', async () => {
    tx.interviewSchedule.findUnique.mockResolvedValue({ id: 55 });
    const res = await upsertInterviewSchedule(args({ locationOrUrl: 'https://new.example.com/b' }));
    expect(res.created).toBe(false);
    expect(recordAuditEvent.mock.calls[0]![0].eventType).toBe('INTERVIEW_UPDATED');
    // update 경로 — scheduledAt/locationOrUrl/status 갱신.
    expect(tx.interviewSchedule.upsert.mock.calls[0]![0].update).toMatchObject({
      status: 'SCHEDULED',
    });
  });

  it('미존재 지원서 → APP_NOT_FOUND (트랜잭션 미진입)', async () => {
    basePrisma.application.findUnique.mockResolvedValue(null);
    await expect(upsertInterviewSchedule(args())).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('감사 metadata는 PII-free (enum/id만)', async () => {
    tx.interviewSchedule.findUnique.mockResolvedValue(null);
    await upsertInterviewSchedule(args());
    const meta = recordAuditEvent.mock.calls[0]![0].metadata;
    expect(JSON.stringify(meta)).not.toMatch(/meet\.example|@|https/);
  });
});
