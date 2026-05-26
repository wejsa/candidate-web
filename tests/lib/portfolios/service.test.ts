// CANDID-017 Step 1 — portfolios/service 단위 테스트 (Prisma mock).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const draftFindUnique = vi.fn();
  const portfolioFindMany = vi.fn();
  const portfolioDeleteMany = vi.fn();
  const portfolioCreateMany = vi.fn();
  const $transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      applicationDraft: { findUnique: draftFindUnique },
      portfolioLink: {
        findMany: portfolioFindMany,
        deleteMany: portfolioDeleteMany,
        createMany: portfolioCreateMany,
      },
    }),
  );
  return {
    basePrisma: {
      applicationDraft: { findUnique: draftFindUnique },
      portfolioLink: {
        findMany: portfolioFindMany,
        deleteMany: portfolioDeleteMany,
        createMany: portfolioCreateMany,
      },
      $transaction,
    },
    prisma: {},
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    applicationDraft: { findUnique: Mock };
    portfolioLink: { findMany: Mock; deleteMany: Mock; createMany: Mock };
    $transaction: Mock;
  };
};
const { listByDraft, replaceForDraft } = await import('@/lib/portfolios/service');
const { AppError } = await import('@/lib/errors');

const USER_ID = 1;
const JOB_POSTING_ID = 100;
const DRAFT_ID = 50;

beforeEach(() => {
  basePrisma.applicationDraft.findUnique.mockReset();
  basePrisma.portfolioLink.findMany.mockReset();
  basePrisma.portfolioLink.deleteMany.mockReset();
  basePrisma.portfolioLink.createMany.mockReset();
  basePrisma.$transaction.mockClear();
});

describe('listByDraft', () => {
  it('Draft 존재 + 링크 있음 → sortOrder 오름차순 반환', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: DRAFT_ID });
    basePrisma.portfolioLink.findMany.mockResolvedValueOnce([
      { id: 1, linkType: 'GITHUB', url: 'https://github.com/a', memo: null, sortOrder: 0 },
      { id: 2, linkType: 'BLOG', url: 'https://blog.example.com', memo: 'note', sortOrder: 1 },
    ]);
    const result = await listByDraft({ userId: USER_ID, jobPostingId: JOB_POSTING_ID });
    expect(result).toHaveLength(2);
    expect(result[0]?.sortOrder).toBe(0);
    expect(result[1]?.memo).toBe('note');
    expect(basePrisma.portfolioLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { draftId: DRAFT_ID }, orderBy: { sortOrder: 'asc' } }),
    );
  });

  it('Draft 미존재 → APP_DRAFT_NOT_FOUND throw', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue(null);
    await expect(
      listByDraft({ userId: USER_ID, jobPostingId: JOB_POSTING_ID }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      listByDraft({ userId: USER_ID, jobPostingId: JOB_POSTING_ID }),
    ).rejects.toMatchObject({ code: 'APP_DRAFT_NOT_FOUND' });
  });

  it('Draft 존재 + 링크 0개 → 빈 배열', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: DRAFT_ID });
    basePrisma.portfolioLink.findMany.mockResolvedValueOnce([]);
    const result = await listByDraft({ userId: USER_ID, jobPostingId: JOB_POSTING_ID });
    expect(result).toEqual([]);
  });
});

describe('replaceForDraft', () => {
  it('정상 replace: delete → create N + sortOrder 0..N-1', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: DRAFT_ID });
    basePrisma.portfolioLink.deleteMany.mockResolvedValueOnce({ count: 3 });
    basePrisma.portfolioLink.createMany.mockResolvedValueOnce({ count: 2 });
    basePrisma.portfolioLink.findMany.mockResolvedValueOnce([
      { id: 10, linkType: 'GITHUB', url: 'https://github.com/a', memo: null, sortOrder: 0 },
      { id: 11, linkType: 'NOTION', url: 'https://notion.so/p', memo: 'm', sortOrder: 1 },
    ]);
    const result = await replaceForDraft({
      userId: USER_ID,
      jobPostingId: JOB_POSTING_ID,
      links: [
        { linkType: 'GITHUB', url: 'https://github.com/a', memo: null },
        { linkType: 'NOTION', url: 'https://notion.so/p', memo: 'm' },
      ],
    });
    expect(result).toHaveLength(2);
    expect(basePrisma.portfolioLink.deleteMany).toHaveBeenCalledWith({ where: { draftId: DRAFT_ID } });
    expect(basePrisma.portfolioLink.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ draftId: DRAFT_ID, sortOrder: 0, linkType: 'GITHUB' }),
        expect.objectContaining({ draftId: DRAFT_ID, sortOrder: 1, linkType: 'NOTION' }),
      ]),
    });
  });

  it('빈 배열 replace: deleteMany만 호출, createMany 호출 안 됨', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: DRAFT_ID });
    basePrisma.portfolioLink.deleteMany.mockResolvedValueOnce({ count: 2 });
    const result = await replaceForDraft({
      userId: USER_ID,
      jobPostingId: JOB_POSTING_ID,
      links: [],
    });
    expect(result).toEqual([]);
    expect(basePrisma.portfolioLink.createMany).not.toHaveBeenCalled();
  });

  it('Draft 미존재 → APP_DRAFT_NOT_FOUND', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    await expect(
      replaceForDraft({
        userId: USER_ID,
        jobPostingId: JOB_POSTING_ID,
        links: [{ linkType: 'GITHUB', url: 'https://github.com/x', memo: null }],
      }),
    ).rejects.toMatchObject({ code: 'APP_DRAFT_NOT_FOUND' });
    expect(basePrisma.portfolioLink.deleteMany).not.toHaveBeenCalled();
  });

  it('6개 입력은 service 런타임에서도 거부 (L-006 layer)', async () => {
    const sixLinks = Array.from({ length: 6 }, () => ({
      linkType: 'BLOG' as const,
      url: 'https://example.com',
      memo: null,
    }));
    await expect(
      replaceForDraft({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, links: sixLinks }),
    ).rejects.toMatchObject({ code: 'SYS_VALIDATION_FAILED' });
    expect(basePrisma.$transaction).not.toHaveBeenCalled();
  });
});
