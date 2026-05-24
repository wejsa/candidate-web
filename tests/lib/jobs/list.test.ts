// CANDID-013 Step 1 — lib/jobs/list 단위 테스트.
// prisma는 mock. next/cache의 unstable_cache는 pass-through (fn 그대로 실행).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const findMany = vi.fn();
  const count = vi.fn();
  return {
    basePrisma: { jobPosting: { findMany, count } },
    prisma: { jobPosting: { findMany, count } },
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    jobPosting: { findMany: Mock; count: Mock };
  };
};
const {
  JobListQuerySchema,
  PER_PAGE,
  MAX_PAGE,
  CLOSED_PREVIEW_COUNT,
  computeDDay,
  listJobs,
} = await import('@/lib/jobs/list');

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: '백엔드 엔지니어',
    employmentType: 'FULL_TIME' as const,
    careerLevel: 'EXPERIENCED' as const,
    opensAt: new Date('2026-05-01T00:00:00Z'),
    closesAt: new Date('2026-06-01T00:00:00Z'),
    jobCategory: { name: '개발', slug: 'dev' },
    ...overrides,
  };
}

beforeEach(() => {
  basePrisma.jobPosting.findMany.mockReset();
  basePrisma.jobPosting.count.mockReset();
});

describe('computeDDay', () => {
  const NOW = new Date('2026-05-24T00:00:00Z');
  it('closesAt null → 상시모집', () => {
    expect(computeDDay(null, NOW)).toBe('상시모집');
  });
  it('이미 지난 마감 → null', () => {
    expect(computeDDay(new Date('2026-05-20T00:00:00Z'), NOW)).toBeNull();
  });
  it('24h 이내 → 오늘 마감', () => {
    expect(computeDDay(new Date('2026-05-24T20:00:00Z'), NOW)).toBe('오늘 마감');
  });
  it('1.5일 후 → D-1', () => {
    expect(computeDDay(new Date('2026-05-25T12:00:00Z'), NOW)).toBe('D-1');
  });
  it('정확히 3일 후 → D-3', () => {
    expect(computeDDay(new Date('2026-05-27T00:00:00Z'), NOW)).toBe('D-3');
  });
});

describe('JobListQuerySchema', () => {
  it('빈 입력 → 기본값(latest, page=1, includeClosed=true)', () => {
    const q = JobListQuerySchema.parse({});
    expect(q).toMatchObject({ sort: 'latest', page: 1, includeClosed: true });
  });
  it('URL 문자열 page와 includeClosed coerce', () => {
    const q = JobListQuerySchema.parse({ page: '3', includeClosed: 'false' });
    expect(q.page).toBe(3);
    expect(q.includeClosed).toBe(false);
  });
  it('빈 문자열 필터는 undefined로 처리', () => {
    const q = JobListQuerySchema.parse({ category: '', employment: '', career: '' });
    expect(q.category).toBeUndefined();
    expect(q.employment).toBeUndefined();
    expect(q.career).toBeUndefined();
  });
  it('잘못된 enum → throw (422 매핑)', () => {
    expect(() => JobListQuerySchema.parse({ employment: 'PART_TIME' })).toThrow();
  });
  it('page > MAX_PAGE → throw', () => {
    expect(() => JobListQuerySchema.parse({ page: MAX_PAGE + 1 })).toThrow();
  });
});

describe('listJobs', () => {
  it('기본: OPEN 필터 + opens_at DESC + take=PER_PAGE', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([row()]);
    basePrisma.jobPosting.count.mockResolvedValueOnce(1);
    // page=1이면 closed 조회도 1회 (basePrisma.findMany 2회 호출)
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([]);

    const res = await listJobs(JobListQuerySchema.parse({}));
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.category.slug).toBe('dev');
    expect(res.pagination).toMatchObject({
      page: 1,
      perPage: PER_PAGE,
      total: 1,
      totalPages: 1,
      hasMore: false,
    });
    expect(res.closedItems).toBeUndefined(); // 마감 조회 결과 0건 → 응답에 미포함

    const activeCall = basePrisma.jobPosting.findMany.mock.calls[0]![0];
    expect(activeCall.where).toMatchObject({ status: 'OPEN' });
    expect(activeCall.orderBy).toEqual([{ opensAt: 'desc' }, { id: 'desc' }]);
    expect(activeCall.take).toBe(PER_PAGE);
    expect(activeCall.skip).toBe(0);
  });

  it('sort=deadline → closesAt asc NULLS LAST', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([]);
    basePrisma.jobPosting.count.mockResolvedValueOnce(0);
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([]);

    await listJobs(JobListQuerySchema.parse({ sort: 'deadline' }));
    const activeCall = basePrisma.jobPosting.findMany.mock.calls[0]![0];
    expect(activeCall.orderBy).toEqual([
      { closesAt: { sort: 'asc', nulls: 'last' } },
      { id: 'desc' },
    ]);
  });

  it('필터 3종 조합 → where 조립', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([]);
    basePrisma.jobPosting.count.mockResolvedValueOnce(0);
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([]);

    await listJobs(
      JobListQuerySchema.parse({
        category: 'dev',
        employment: 'CONTRACT',
        career: 'NEW',
      }),
    );
    const activeCall = basePrisma.jobPosting.findMany.mock.calls[0]![0];
    expect(activeCall.where).toMatchObject({
      status: 'OPEN',
      employmentType: 'CONTRACT',
      careerLevel: 'NEW',
      jobCategory: { is: { slug: 'dev' } },
    });
  });

  it('page > 1 → 마감 미리보기 미조회 (findMany 1회)', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([row()]);
    basePrisma.jobPosting.count.mockResolvedValueOnce(50);

    const res = await listJobs(JobListQuerySchema.parse({ page: '2' }));
    expect(basePrisma.jobPosting.findMany).toHaveBeenCalledTimes(1);
    expect(res.closedItems).toBeUndefined();
    expect(res.pagination).toMatchObject({
      page: 2,
      total: 50,
      totalPages: 3, // ceil(50/20)
      hasMore: true,
    });
  });

  it('includeClosed=false → 마감 미리보기 미조회', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([row()]);
    basePrisma.jobPosting.count.mockResolvedValueOnce(1);

    await listJobs(JobListQuerySchema.parse({ includeClosed: 'false' }));
    expect(basePrisma.jobPosting.findMany).toHaveBeenCalledTimes(1);
  });

  it('page=1 + 마감 결과 존재 → closedItems 최대 5건', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([row({ id: 10 })]);
    basePrisma.jobPosting.count.mockResolvedValueOnce(1);
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([
      row({ id: 91 }),
      row({ id: 92 }),
    ]);

    const res = await listJobs(JobListQuerySchema.parse({}));
    expect(res.closedItems).toHaveLength(2);
    const closedCall = basePrisma.jobPosting.findMany.mock.calls[1]![0];
    expect(closedCall.where).toMatchObject({ status: 'CLOSED' });
    expect(closedCall.take).toBe(CLOSED_PREVIEW_COUNT);
    expect(closedCall.orderBy).toEqual([{ closesAt: 'desc' }, { id: 'desc' }]);
  });

  it('빈 결과: totalPages=1, hasMore=false (0 div 방지)', async () => {
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([]);
    basePrisma.jobPosting.count.mockResolvedValueOnce(0);
    basePrisma.jobPosting.findMany.mockResolvedValueOnce([]);

    const res = await listJobs(JobListQuerySchema.parse({}));
    expect(res.items).toEqual([]);
    expect(res.pagination.totalPages).toBe(1);
    expect(res.pagination.hasMore).toBe(false);
  });
});
