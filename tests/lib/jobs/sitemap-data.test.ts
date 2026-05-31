// CANDID-025 Step 2 — lib/jobs/sitemap-data 단위 테스트.
// prisma는 mock. next/cache의 unstable_cache는 pass-through (fn 그대로 실행).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { JobStatus } from '@prisma/client';

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const findMany = vi.fn();
  return {
    basePrisma: { jobPosting: { findMany } },
    prisma: { jobPosting: { findMany } },
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: { jobPosting: { findMany: Mock } };
};
const { listIndexableJobs, __resetSitemapCacheForTesting } =
  await import('@/lib/jobs/sitemap-data');

beforeEach(() => {
  vi.resetAllMocks();
  __resetSitemapCacheForTesting();
});

describe('listIndexableJobs', () => {
  it('queries only non-DRAFT jobs (OPEN/CLOSED) selecting id+updatedAt, ordered by id', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValue([
      { id: 1, updatedAt: new Date('2026-05-01T00:00:00.000Z') },
      { id: 2, updatedAt: new Date('2026-05-02T00:00:00.000Z') },
    ]);

    const jobs = await listIndexableJobs();

    expect(jobs).toHaveLength(2);
    expect(basePrisma.jobPosting.findMany).toHaveBeenCalledWith({
      where: { status: { in: [JobStatus.OPEN, JobStatus.CLOSED] } },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
  });

  it('includes CLOSED jobs (BR-JOB-02 — 마감 공고도 SEO 자산)', async () => {
    // 쿼리 where 절에 CLOSED가 포함됨을 보장 — DRAFT만 배제.
    basePrisma.jobPosting.findMany.mockResolvedValue([]);
    await listIndexableJobs();
    const arg = basePrisma.jobPosting.findMany.mock.calls[0]?.[0] as {
      where: { status: { in: JobStatus[] } };
    };
    expect(arg.where.status.in).toContain(JobStatus.CLOSED);
    expect(arg.where.status.in).not.toContain(JobStatus.DRAFT);
  });

  it('returns an empty list when there are no indexable jobs', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValue([]);
    expect(await listIndexableJobs()).toEqual([]);
  });
});
