import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// CANDID-053 Step 9 — 운영자 공고 read 서비스 단위 테스트(전 상태 노출/매핑/페이징/단건 404).

vi.mock('@/lib/prisma', () => ({
  basePrisma: {
    jobPosting: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    jobCategory: { findMany: vi.fn() },
  },
}));

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    jobPosting: { count: Mock; findMany: Mock; findUnique: Mock };
    jobCategory: { findMany: Mock };
  };
};
const { listJobPostingsForAdmin, listJobCategoryOptions, getJobPostingForEdit } = await import(
  '@/lib/admin/job-postings-list'
);

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: '백엔드 엔지니어',
    status: 'DRAFT',
    employmentType: 'FULL_TIME',
    careerLevel: 'EXPERIENCED',
    opensAt: new Date('2026-07-01T00:00:00Z'),
    closesAt: null,
    jobCategory: { name: '엔지니어링' },
    _count: { applications: 3 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listJobPostingsForAdmin', () => {
  it('전 상태(DRAFT/CLOSED 포함) 매핑 + 지원 건수 + 카테고리명', async () => {
    basePrisma.jobPosting.count.mockResolvedValue(2);
    basePrisma.jobPosting.findMany.mockResolvedValue([
      row(),
      row({ id: 2, status: 'CLOSED', _count: { applications: 0 } }),
    ]);
    const res = await listJobPostingsForAdmin(1);
    expect(res.items[0]).toMatchObject({
      id: 1,
      status: 'DRAFT',
      categoryName: '엔지니어링',
      applicationCount: 3,
    });
    expect(res.items[1]!.status).toBe('CLOSED');
    // 공개 목록과 달리 status 필터 없음(전 상태) — where 미지정.
    expect(basePrisma.jobPosting.findMany.mock.calls[0]![0].where).toBeUndefined();
  });

  it('페이징: page=3 → skip=(3-1)*20', async () => {
    basePrisma.jobPosting.count.mockResolvedValue(45);
    basePrisma.jobPosting.findMany.mockResolvedValue([]);
    const res = await listJobPostingsForAdmin(3);
    expect(basePrisma.jobPosting.findMany.mock.calls[0]![0]).toMatchObject({ skip: 40, take: 20 });
    expect(res.pagination).toMatchObject({ page: 3, total: 45, totalPages: 3, hasMore: false });
  });

  it.each([0, -5, NaN])('비정상 page(%s) → 1로 정규화', async (p) => {
    basePrisma.jobPosting.count.mockResolvedValue(0);
    basePrisma.jobPosting.findMany.mockResolvedValue([]);
    const res = await listJobPostingsForAdmin(p as number);
    expect(res.pagination.page).toBe(1);
  });

  it('첫 페이지에 다음이 있으면 hasMore=true', async () => {
    basePrisma.jobPosting.count.mockResolvedValue(45); // 3 페이지
    basePrisma.jobPosting.findMany.mockResolvedValue([]);
    const res = await listJobPostingsForAdmin(1);
    expect(res.pagination).toMatchObject({ totalPages: 3, hasMore: true });
  });

  it('빈 목록 → totalPages=1, hasMore=false, items=[]', async () => {
    basePrisma.jobPosting.count.mockResolvedValue(0);
    basePrisma.jobPosting.findMany.mockResolvedValue([]);
    const res = await listJobPostingsForAdmin(1);
    expect(res.pagination).toMatchObject({ total: 0, totalPages: 1, hasMore: false });
    expect(res.items).toEqual([]);
  });

  it('page가 MAX_PAGE(10000) 초과 → 상한 클램프(skip 폭주 방어)', async () => {
    basePrisma.jobPosting.count.mockResolvedValue(0);
    basePrisma.jobPosting.findMany.mockResolvedValue([]);
    const res = await listJobPostingsForAdmin(99999);
    expect(res.pagination.page).toBe(10_000);
    expect(basePrisma.jobPosting.findMany.mock.calls[0]![0].skip).toBe((10_000 - 1) * 20);
  });

  it.each(['DRAFT', 'OPEN', 'CLOSED'])('상태 %s 매핑(전 상태 노출)', async (status) => {
    basePrisma.jobPosting.count.mockResolvedValue(1);
    basePrisma.jobPosting.findMany.mockResolvedValue([row({ status })]);
    const res = await listJobPostingsForAdmin(1);
    expect(res.items[0]!.status).toBe(status);
  });
});

describe('listJobCategoryOptions', () => {
  it('활성 카테고리만 sortOrder→name 정렬로 조회', async () => {
    basePrisma.jobCategory.findMany.mockResolvedValue([{ id: 1, name: '엔지니어링' }]);
    const res = await listJobCategoryOptions();
    expect(res).toEqual([{ id: 1, name: '엔지니어링' }]);
    expect(basePrisma.jobCategory.findMany.mock.calls[0]![0]).toMatchObject({
      where: { active: true },
    });
  });
});

describe('getJobPostingForEdit', () => {
  it('단건 프리필 반환(전 상태 허용)', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue(
      row({ jobCategoryId: 7, contentHtml: '<p>본문</p>' }),
    );
    const res = await getJobPostingForEdit(1);
    expect(res).toMatchObject({ id: 1, jobCategoryId: 7, contentHtml: '<p>본문</p>' });
  });

  it('미존재 → JOB_NOT_FOUND', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue(null);
    await expect(getJobPostingForEdit(999)).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });
});
