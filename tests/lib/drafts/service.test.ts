// CANDID-015 Step 1 — lib/drafts/service 단위 테스트.
// Prisma mock — 공고 게이트 / Draft upsert / 낙관적 락 분기 검증.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => {
  const jobPostingFindUnique = vi.fn();
  const draftFindUnique = vi.fn();
  const draftCreate = vi.fn();
  const draftUpdateMany = vi.fn();
  const draftDelete = vi.fn();
  const resumeFindMany = vi.fn();
  const resumeDeleteMany = vi.fn();
  // $transaction: 콜백에 tx(resumeFile.deleteMany + applicationDraft.delete) 주입.
  const txClient = {
    resumeFile: { deleteMany: resumeDeleteMany },
    applicationDraft: { delete: draftDelete },
  };
  const $transaction = vi.fn((cb: (tx: typeof txClient) => unknown) => cb(txClient));
  const base = {
    jobPosting: { findUnique: jobPostingFindUnique },
    applicationDraft: {
      findUnique: draftFindUnique,
      create: draftCreate,
      updateMany: draftUpdateMany,
      delete: draftDelete,
    },
    resumeFile: { findMany: resumeFindMany, deleteMany: resumeDeleteMany },
    $transaction,
  };
  return { basePrisma: base, prisma: base };
});

vi.mock('@/lib/files/storage', () => ({
  deleteResumeObject: vi.fn().mockResolvedValue(undefined),
}));

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    jobPosting: { findUnique: Mock };
    applicationDraft: { findUnique: Mock; create: Mock; updateMany: Mock; delete: Mock };
    resumeFile: { findMany: Mock; deleteMany: Mock };
    $transaction: Mock;
  };
};
const { deleteResumeObject } = (await import('@/lib/files/storage')) as unknown as {
  deleteResumeObject: Mock;
};
const { getOrInitDraft, upsertDraft, discardDraft } = await import('@/lib/drafts/service');
const { AppError } = await import('@/lib/errors');
const { initialPayload } = await import('@/lib/drafts/schema');

const NOW = new Date('2026-05-24T00:00:00Z');
const FUTURE = new Date('2026-06-01T00:00:00Z');
const PAST = new Date('2026-05-23T23:59:59Z');

beforeEach(() => {
  basePrisma.jobPosting.findUnique.mockReset();
  basePrisma.applicationDraft.findUnique.mockReset();
  basePrisma.applicationDraft.create.mockReset();
  basePrisma.applicationDraft.updateMany.mockReset();
  basePrisma.applicationDraft.delete.mockReset();
  basePrisma.resumeFile.findMany.mockReset();
  basePrisma.resumeFile.deleteMany.mockReset();
  basePrisma.$transaction.mockClear(); // 구현(콜백 실행) 유지, 호출 기록만 초기화
  deleteResumeObject.mockReset();
  deleteResumeObject.mockResolvedValue(undefined);
});

describe('getOrInitDraft — 공고 게이트', () => {
  it('미존재 공고 → JOB_NOT_FOUND', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(null);
    await expect(getOrInitDraft(1, 999, NOW)).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('DRAFT 공고 (비공개) → JOB_NOT_FOUND', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: 1,
      status: 'DRAFT',
      closesAt: FUTURE,
    });
    await expect(getOrInitDraft(1, 1, NOW)).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('CLOSED 공고 → JOB_CLOSED', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: 1,
      status: 'CLOSED',
      closesAt: FUTURE,
    });
    await expect(getOrInitDraft(1, 1, NOW)).rejects.toMatchObject({ code: 'JOB_CLOSED' });
  });

  it('OPEN + closesAt < now → JOB_CLOSED (F-1 cron 미도입 가드)', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: 1,
      status: 'OPEN',
      closesAt: PAST,
    });
    await expect(getOrInitDraft(1, 1, NOW)).rejects.toMatchObject({ code: 'JOB_CLOSED' });
  });

  it('OPEN + closesAt null (상시) → 통과', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: 1,
      status: 'OPEN',
      closesAt: null,
    });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    basePrisma.applicationDraft.create.mockResolvedValueOnce({
      id: 10,
      payloadJson: initialPayload(),
      version: 1,
      lastSavedAt: NOW,
    });
    const result = await getOrInitDraft(1, 1, NOW);
    expect(result.created).toBe(true);
  });
});

describe('getOrInitDraft — Draft 진입', () => {
  beforeEach(() => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({
      id: 1,
      status: 'OPEN',
      closesAt: FUTURE,
    });
  });

  it('기존 Draft 존재 → created:false + 그대로 반환', async () => {
    const existing = {
      id: 7,
      payloadJson: { schemaVersion: 1, meta: { currentStep: 2, completedSteps: [1] } },
      version: 5,
      lastSavedAt: PAST,
    };
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(existing);
    const result = await getOrInitDraft(100, 1, NOW);
    expect(result.created).toBe(false);
    expect(result.draft).toEqual(existing);
    expect(basePrisma.applicationDraft.create).not.toHaveBeenCalled();
  });

  it('Draft 미존재 → created:true + 초기 payload + version=1', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    basePrisma.applicationDraft.create.mockResolvedValueOnce({
      id: 10,
      payloadJson: initialPayload(),
      version: 1,
      lastSavedAt: NOW,
    });
    const result = await getOrInitDraft(100, 1, NOW);
    expect(result.created).toBe(true);
    expect(result.draft.version).toBe(1);
    const createArg = basePrisma.applicationDraft.create.mock.calls[0]![0];
    expect(createArg.data.userId).toBe(100);
    expect(createArg.data.jobPostingId).toBe(1);
    expect(createArg.data.version).toBe(1);
    expect(createArg.data.payloadJson).toEqual(initialPayload());
  });

  it('findUnique는 uk_drafts_user_posting 복합 UNIQUE 사용', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    basePrisma.applicationDraft.create.mockResolvedValueOnce({
      id: 1,
      payloadJson: initialPayload(),
      version: 1,
      lastSavedAt: NOW,
    });
    await getOrInitDraft(100, 1, NOW);
    const arg = basePrisma.applicationDraft.findUnique.mock.calls[0]![0];
    expect(arg.where).toEqual({ userId_jobPostingId: { userId: 100, jobPostingId: 1 } });
  });
});

describe('upsertDraft — 신규 (expectedVersion=0)', () => {
  beforeEach(() => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({
      id: 1,
      status: 'OPEN',
      closesAt: FUTURE,
    });
  });

  it('신규 생성 성공 → version=1 반환', async () => {
    basePrisma.applicationDraft.create.mockResolvedValueOnce({ version: 1, lastSavedAt: NOW });
    const result = await upsertDraft({
      userId: 100,
      jobPostingId: 1,
      payload: initialPayload(),
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.version).toBe(1);
    expect(basePrisma.applicationDraft.updateMany).not.toHaveBeenCalled();
  });

  it('신규 생성 중 P2002 → APP_DRAFT_CONFLICT (다른 탭 race)', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '6.0.0',
      meta: { target: ['user_id', 'job_posting_id'] },
    });
    basePrisma.applicationDraft.create.mockRejectedValueOnce(p2002);
    await expect(
      upsertDraft({
        userId: 100,
        jobPostingId: 1,
        payload: initialPayload(),
        expectedVersion: 0,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'APP_DRAFT_CONFLICT' });
  });
});

describe('upsertDraft — 낙관적 락 (L-024)', () => {
  beforeEach(() => {
    basePrisma.jobPosting.findUnique.mockResolvedValue({
      id: 1,
      status: 'OPEN',
      closesAt: FUTURE,
    });
  });

  it('version 일치 → updateMany count=1 → version+1 반환', async () => {
    basePrisma.applicationDraft.updateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ version: 6, lastSavedAt: NOW });
    const result = await upsertDraft({
      userId: 100,
      jobPostingId: 1,
      payload: initialPayload(),
      expectedVersion: 5,
      now: NOW,
    });
    expect(result.version).toBe(6);
    const arg = basePrisma.applicationDraft.updateMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ userId: 100, jobPostingId: 1, version: 5 });
    expect(arg.data.version).toEqual({ increment: 1 });
  });

  it('version mismatch → updateMany count=0 → APP_DRAFT_CONFLICT', async () => {
    basePrisma.applicationDraft.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      upsertDraft({
        userId: 100,
        jobPostingId: 1,
        payload: initialPayload(),
        expectedVersion: 5,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'APP_DRAFT_CONFLICT' });
  });

  it('updateMany 직후 row 사라짐 → APP_DRAFT_CONFLICT (defense-in-depth)', async () => {
    basePrisma.applicationDraft.updateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    await expect(
      upsertDraft({
        userId: 100,
        jobPostingId: 1,
        payload: initialPayload(),
        expectedVersion: 5,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'APP_DRAFT_CONFLICT' });
  });

  it('마감 공고에는 upsertDraft 자체가 차단', async () => {
    basePrisma.jobPosting.findUnique.mockReset();
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: 1,
      status: 'CLOSED',
      closesAt: FUTURE,
    });
    await expect(
      upsertDraft({
        userId: 100,
        jobPostingId: 1,
        payload: initialPayload(),
        expectedVersion: 5,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'JOB_CLOSED' });
  });
});

describe('discardDraft — 작성 취소', () => {
  it('draft 미존재 → no-op (멱등): 삭제/스토리지 호출 없음', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);

    await expect(discardDraft(7, 42)).resolves.toBeUndefined();

    expect(basePrisma.resumeFile.findMany).not.toHaveBeenCalled();
    expect(deleteResumeObject).not.toHaveBeenCalled();
    expect(basePrisma.$transaction).not.toHaveBeenCalled();
  });

  it('첨부 없는 draft → S3 미호출, 트랜잭션에서 draftId 스코프 삭제 + draft 삭제', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: 100 });
    basePrisma.resumeFile.findMany.mockResolvedValueOnce([]);

    await discardDraft(7, 42);

    expect(deleteResumeObject).not.toHaveBeenCalled();
    // 동시 제출 경합 방어: 첨부 0건이라도 draftId 스코프 deleteMany 수행(재부모화 행 제외).
    expect(basePrisma.resumeFile.deleteMany).toHaveBeenCalledWith({ where: { draftId: 100 } });
    expect(basePrisma.applicationDraft.delete).toHaveBeenCalledWith({ where: { id: 100 } });
  });

  it('첨부 있는 draft → S3 선삭제 후 resume_files(draftId 스코프) + draft 삭제', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: 100 });
    basePrisma.resumeFile.findMany.mockResolvedValueOnce([
      { id: 11, storedPath: 'resumes/2026/06/a.pdf' },
      { id: 12, storedPath: 'resumes/2026/06/b.pdf' },
    ]);

    await discardDraft(7, 42);

    expect(deleteResumeObject).toHaveBeenCalledTimes(2);
    expect(deleteResumeObject).toHaveBeenCalledWith('resumes/2026/06/a.pdf');
    // id 기준이 아니라 draftId 기준 — 동시 제출로 재부모화된(draftId=null) 첨부 오삭제 방지.
    expect(basePrisma.resumeFile.deleteMany).toHaveBeenCalledWith({ where: { draftId: 100 } });
    expect(basePrisma.applicationDraft.delete).toHaveBeenCalledWith({ where: { id: 100 } });
  });

  it('S3 삭제 실패 시 throw — DB 삭제 미수행 (orphan 방지)', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: 100 });
    basePrisma.resumeFile.findMany.mockResolvedValueOnce([
      { id: 11, storedPath: 'resumes/2026/06/a.pdf' },
    ]);
    deleteResumeObject.mockRejectedValueOnce(new Error('S3 down'));

    await expect(discardDraft(7, 42)).rejects.toThrow('S3 down');

    expect(basePrisma.$transaction).not.toHaveBeenCalled();
    expect(basePrisma.applicationDraft.delete).not.toHaveBeenCalled();
  });

  it('본인 스코프 — findUnique가 (userId, jobPostingId) 복합키로 조회', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);

    await discardDraft(7, 42);

    expect(basePrisma.applicationDraft.findUnique).toHaveBeenCalledWith({
      where: { userId_jobPostingId: { userId: 7, jobPostingId: 42 } },
      select: { id: true },
    });
  });
});
