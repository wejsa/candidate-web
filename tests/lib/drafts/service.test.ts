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
  return {
    basePrisma: {
      jobPosting: { findUnique: jobPostingFindUnique },
      applicationDraft: {
        findUnique: draftFindUnique,
        create: draftCreate,
        updateMany: draftUpdateMany,
      },
    },
    prisma: {
      jobPosting: { findUnique: jobPostingFindUnique },
      applicationDraft: {
        findUnique: draftFindUnique,
        create: draftCreate,
        updateMany: draftUpdateMany,
      },
    },
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    jobPosting: { findUnique: Mock };
    applicationDraft: { findUnique: Mock; create: Mock; updateMany: Mock };
  };
};
const { getOrInitDraft, upsertDraft } = await import('@/lib/drafts/service');
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
