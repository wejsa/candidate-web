import { AuditEventType, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuditMetadataError,
  assertPiiFreeMetadata,
  recordAuditEvent,
} from '@/lib/audit/record';
import { runWithTrace } from '@/lib/observability/trace-context';

// basePrisma(기본 클라이언트) 경로 검증을 위해 @/lib/prisma를 모킹 — 실제 PrismaClient 미인스턴스화.
const { baseCreate } = vi.hoisted(() => ({ baseCreate: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  basePrisma: { auditLog: { create: baseCreate } },
  prisma: {},
}));

interface CreatedData {
  data: Prisma.AuditLogUncheckedCreateInput;
}

function fakeTx() {
  const create = vi.fn().mockResolvedValue({});
  return { client: { auditLog: { create } }, create };
}

beforeEach(() => {
  baseCreate.mockReset().mockResolvedValue({});
});

describe('recordAuditEvent — 기록 경로', () => {
  it('tx가 주어지면 tx.auditLog.create로 기록하고 basePrisma는 쓰지 않는다', async () => {
    const tx = fakeTx();
    await recordAuditEvent(
      {
        eventType: AuditEventType.PASSWORD_CHANGE,
        actorUserId: 42,
        resourceType: 'user',
        resourceId: '42',
        ipAddress: '10.0.0.1',
        userAgent: 'vitest',
        metadata: { mode: 'changed' },
      },
      { tx: tx.client },
    );
    expect(tx.create).toHaveBeenCalledOnce();
    expect(baseCreate).not.toHaveBeenCalled();
    const { data } = tx.create.mock.calls[0]![0] as CreatedData;
    expect(data).toMatchObject({
      eventType: AuditEventType.PASSWORD_CHANGE,
      actorUserId: 42,
      resourceType: 'user',
      resourceId: '42',
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
      metadataJson: { mode: 'changed' },
    });
  });

  it('tx가 없으면 basePrisma.auditLog.create로 기록한다', async () => {
    await recordAuditEvent({ eventType: AuditEventType.LOGIN_SUCCESS, actorUserId: 7 });
    expect(baseCreate).toHaveBeenCalledOnce();
    const { data } = baseCreate.mock.calls[0]![0] as CreatedData;
    expect(data.eventType).toBe(AuditEventType.LOGIN_SUCCESS);
    expect(data.actorUserId).toBe(7);
  });

  it('선택 필드 미지정 시 null로 기록한다', async () => {
    const tx = fakeTx();
    await recordAuditEvent({ eventType: AuditEventType.PII_VIEW }, { tx: tx.client });
    const { data } = tx.create.mock.calls[0]![0] as CreatedData;
    expect(data.actorUserId).toBeNull();
    expect(data.resourceType).toBeNull();
    expect(data.ipAddress).toBeNull();
    expect(data.userAgent).toBeNull();
  });

  it('metadata 미지정 시 metadataJson은 DbNull(SQL NULL)', async () => {
    const tx = fakeTx();
    await recordAuditEvent({ eventType: AuditEventType.PII_VIEW }, { tx: tx.client });
    const { data } = tx.create.mock.calls[0]![0] as CreatedData;
    expect(data.metadataJson).toBe(Prisma.DbNull);
  });
});

describe('recordAuditEvent — traceId 자동 첨부 (CANDID-026 Step 1 연계)', () => {
  it('ALS 컨텍스트의 traceId를 자동 기록한다', async () => {
    const tx = fakeTx();
    await runWithTrace('trace-xyz', () =>
      recordAuditEvent({ eventType: AuditEventType.LOGIN_SUCCESS }, { tx: tx.client }),
    );
    const { data } = tx.create.mock.calls[0]![0] as CreatedData;
    expect(data.traceId).toBe('trace-xyz');
  });

  it('컨텍스트 밖에서는 traceId가 null이다', async () => {
    const tx = fakeTx();
    await recordAuditEvent({ eventType: AuditEventType.LOGIN_SUCCESS }, { tx: tx.client });
    const { data } = tx.create.mock.calls[0]![0] as CreatedData;
    expect(data.traceId).toBeNull();
  });
});

describe('assertPiiFreeMetadata — PII-free 회귀 가드 (BR-PII-01/02)', () => {
  it('PII-free metadata는 그대로 통과시킨다', () => {
    const meta = { mode: 'changed', count: 3, hasReason: true, reasonLength: 12 };
    expect(assertPiiFreeMetadata(meta)).toBe(meta);
  });

  it('undefined는 undefined로 통과', () => {
    expect(assertPiiFreeMetadata(undefined)).toBeUndefined();
  });

  it.each([
    ['email', { email: 'a@b.com' }],
    ['phone', { phone: '010-1234-5678' }],
    ['token', { token: 'abc' }],
    ['password', { password: 'x' }],
    ['name', { name: '홍길동' }],
    ['birthDate', { birthDate: '1990-01-01' }],
    ['secret', { secret: 'x' }],
  ])('금지 키 "%s"가 있으면 throw', (_label, meta) => {
    expect(() => assertPiiFreeMetadata(meta)).toThrow(AuditMetadataError);
  });

  it.each([
    ['이메일 형태 값', { contact: 'user@example.com' }],
    ['전화번호 형태 값', { ref: '010-1234-5678' }],
  ])('값이 PII 패턴(%s)이면 throw', (_label, meta) => {
    expect(() => assertPiiFreeMetadata(meta)).toThrow(AuditMetadataError);
  });

  it('256자 초과 문자열 값은 throw', () => {
    expect(() => assertPiiFreeMetadata({ blob: 'x'.repeat(257) })).toThrow(AuditMetadataError);
  });

  it('recordAuditEvent는 PII metadata를 만나면 기록 전에 throw한다 (fail-closed)', async () => {
    const tx = fakeTx();
    await expect(
      recordAuditEvent(
        { eventType: AuditEventType.LOGIN_SUCCESS, metadata: { email: 'a@b.com' } },
        { tx: tx.client },
      ),
    ).rejects.toThrow(AuditMetadataError);
    expect(tx.create).not.toHaveBeenCalled();
  });
});
