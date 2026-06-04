// CANDID-053 Step 4 — 공고 CRUD 서비스 단위 테스트.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { jobCategory: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));
vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/lib/security/sanitize', () => ({ sanitizeHtml: vi.fn((h: string) => `CLEAN:${h}`) }));

const { prisma } = (await import('@/lib/prisma')) as unknown as {
  prisma: { jobCategory: { findUnique: Mock }; $transaction: Mock };
};
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { sanitizeHtml } = (await import('@/lib/security/sanitize')) as unknown as {
  sanitizeHtml: Mock;
};
const { createJobPosting, updateJobPosting } = await import('@/lib/admin/job-postings');

interface TxMock {
  $queryRaw: Mock;
  jobPosting: { create: Mock; update: Mock };
}
let tx: TxMock;
beforeEach(() => {
  vi.resetAllMocks();
  sanitizeHtml.mockImplementation((h: string) => `CLEAN:${h}`);
  tx = {
    $queryRaw: vi.fn(),
    jobPosting: { create: vi.fn(), update: vi.fn().mockResolvedValue({ id: 10, title: 'BE', status: 'DRAFT' }) },
  };
  prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
});

const createInput = {
  title: 'BE',
  jobCategoryId: 1,
  employmentType: 'FULL_TIME' as const,
  careerLevel: 'ANY' as const,
  contentHtml: '<p>hi</p>',
  opensAt: '2026-07-01T00:00:00.000Z',
};

/** updateJobPosting의 FOR UPDATE 행 잠금 조회를 모사. */
function lockRow(status: string) {
  tx.$queryRaw.mockResolvedValue([
    { status, opens_at: new Date('2026-07-01T00:00:00.000Z'), closes_at: null },
  ]);
}

describe('createJobPosting', () => {
  it('카테고리 존재 → DRAFT 생성 + contentHtml 정화 + JOB_POSTING_CREATED 감사', async () => {
    prisma.jobCategory.findUnique.mockResolvedValue({ id: 1 });
    tx.jobPosting.create.mockResolvedValue({ id: 10, title: 'BE', status: 'DRAFT' });
    const r = await createJobPosting({ actorUserId: 1, input: createInput });
    expect(r).toMatchObject({ id: 10, status: 'DRAFT' });
    expect(sanitizeHtml).toHaveBeenCalledWith('<p>hi</p>', 'job-posting');
    expect(tx.jobPosting.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentHtml: 'CLEAN:<p>hi</p>', status: 'DRAFT' }) }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'JOB_POSTING_CREATED' }),
      expect.objectContaining({ tx }),
    );
  });

  it('미존재 카테고리 → SYS_VALIDATION_FAILED (트랜잭션 미진입)', async () => {
    prisma.jobCategory.findUnique.mockResolvedValue(null);
    await expect(createJobPosting({ actorUserId: 1, input: createInput })).rejects.toMatchObject({
      code: 'SYS_VALIDATION_FAILED',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('closesAt <= opensAt → SYS_VALIDATION_FAILED (즉시-마감 차단)', async () => {
    prisma.jobCategory.findUnique.mockResolvedValue({ id: 1 });
    await expect(
      createJobPosting({
        actorUserId: 1,
        input: { ...createInput, closesAt: '2026-06-01T00:00:00.000Z' },
      }),
    ).rejects.toMatchObject({ code: 'SYS_VALIDATION_FAILED' });
  });
});

describe('updateJobPosting', () => {
  it('내용 수정 → JOB_POSTING_UPDATED + 정화', async () => {
    lockRow('DRAFT');
    await updateJobPosting({ actorUserId: 1, jobPostingId: 10, patch: { contentHtml: '<b>x</b>' } });
    expect(sanitizeHtml).toHaveBeenCalledWith('<b>x</b>', 'job-posting');
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'JOB_POSTING_UPDATED' }),
      expect.anything(),
    );
  });

  it('DRAFT→OPEN 전이 → JOB_POSTING_STATUS_CHANGED', async () => {
    lockRow('DRAFT');
    tx.jobPosting.update.mockResolvedValue({ id: 10, title: 'BE', status: 'OPEN' });
    await updateJobPosting({ actorUserId: 1, jobPostingId: 10, patch: { status: 'OPEN' } });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'JOB_POSTING_STATUS_CHANGED', metadata: { from: 'DRAFT', to: 'OPEN' } }),
      expect.anything(),
    );
  });

  it('OPEN→CLOSED 전이(라이브 마감) → STATUS_CHANGED {from:OPEN,to:CLOSED}', async () => {
    lockRow('OPEN');
    tx.jobPosting.update.mockResolvedValue({ id: 10, title: 'BE', status: 'CLOSED' });
    await updateJobPosting({ actorUserId: 1, jobPostingId: 10, patch: { status: 'CLOSED' } });
    expect(tx.jobPosting.update).toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'JOB_POSTING_STATUS_CHANGED', metadata: { from: 'OPEN', to: 'CLOSED' } }),
      expect.anything(),
    );
  });

  it('DRAFT→CLOSED 전이(미게시 폐기) 허용', async () => {
    lockRow('DRAFT');
    tx.jobPosting.update.mockResolvedValue({ id: 10, title: 'BE', status: 'CLOSED' });
    await updateJobPosting({ actorUserId: 1, jobPostingId: 10, patch: { status: 'CLOSED' } });
    expect(tx.jobPosting.update).toHaveBeenCalled();
  });

  it('OPEN→DRAFT 전이(공개 회수) 허용 (FR-005 ↔)', async () => {
    lockRow('OPEN');
    tx.jobPosting.update.mockResolvedValue({ id: 10, title: 'BE', status: 'DRAFT' });
    await updateJobPosting({ actorUserId: 1, jobPostingId: 10, patch: { status: 'DRAFT' } });
    expect(tx.jobPosting.update).toHaveBeenCalled();
  });

  it('CLOSED→OPEN(종단 위반) → JOB_INVALID_STATUS_TRANSITION', async () => {
    lockRow('CLOSED');
    await expect(
      updateJobPosting({ actorUserId: 1, jobPostingId: 10, patch: { status: 'OPEN' } }),
    ).rejects.toMatchObject({ code: 'JOB_INVALID_STATUS_TRANSITION' });
    expect(tx.jobPosting.update).not.toHaveBeenCalled();
  });

  it('미존재 공고 → JOB_NOT_FOUND', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      updateJobPosting({ actorUserId: 1, jobPostingId: 99, patch: { title: 'x' } }),
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });
});
