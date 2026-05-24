// CANDID-014 Step 1 — lib/jobs/detail 단위 테스트.
// prisma는 mock. next/cache의 unstable_cache는 pass-through.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// CANDID-014 Step 3 L-019 (T-MAJOR-1): unstable_cache 키/옵션 spy로 회귀 가드.
const unstableCacheSpy = vi.fn();
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    keys?: unknown,
    opts?: unknown,
  ) => {
    unstableCacheSpy(fn, keys, opts);
    return fn;
  },
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const findUnique = vi.fn();
  return {
    basePrisma: { jobPosting: { findUnique } },
    prisma: { jobPosting: { findUnique } },
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: { jobPosting: { findUnique: Mock } };
};
const { getJobDetail, detailCacheTag } = await import('@/lib/jobs/detail');
const { AppError } = await import('@/lib/errors');

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: '백엔드 엔지니어',
    employmentType: 'FULL_TIME' as const,
    careerLevel: 'EXPERIENCED' as const,
    contentHtml: '<p>안녕하세요</p>',
    opensAt: new Date('2026-05-01T00:00:00Z'),
    closesAt: new Date('2026-06-01T00:00:00Z'),
    status: 'OPEN' as const,
    jobCategory: { name: '개발', slug: 'dev' },
    questions: [],
    ...overrides,
  };
}

beforeEach(() => {
  basePrisma.jobPosting.findUnique.mockReset();
  unstableCacheSpy.mockReset();
  vi.useRealTimers();
});

describe('detailCacheTag', () => {
  it('id별 독립 태그', () => {
    expect(detailCacheTag(1)).toBe('jobs-detail-1');
    expect(detailCacheTag(42)).toBe('jobs-detail-42');
  });
});

describe('getJobDetail — unstable_cache 키/옵션 회귀 가드 (T-MAJOR-1)', () => {
  it('키 배열은 [prefix, String(id)] + revalidate=60 + tags=[detailCacheTag(id)]', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(row({ id: 42 }));
    await getJobDetail(42);
    expect(unstableCacheSpy).toHaveBeenCalledWith(
      expect.any(Function),
      ['jobs-detail', '42'],
      expect.objectContaining({ revalidate: 60, tags: ['jobs-detail-42'] }),
    );
  });

  it('id별 키 분리 — 다른 id는 다른 키 배열', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(row({ id: 1 }));
    await getJobDetail(1);
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(row({ id: 2 }));
    await getJobDetail(2);
    expect(unstableCacheSpy.mock.calls[0]![1]).toEqual(['jobs-detail', '1']);
    expect(unstableCacheSpy.mock.calls[1]![1]).toEqual(['jobs-detail', '2']);
  });
});

describe('getJobDetail — 정상', () => {
  it('OPEN 공고 → JobDetail 반환 + isClosed false', async () => {
    vi.setSystemTime(new Date('2026-05-24T00:00:00Z'));
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(row());
    const detail = await getJobDetail(1);
    expect(detail.id).toBe(1);
    expect(detail.title).toBe('백엔드 엔지니어');
    expect(detail.status).toBe('OPEN');
    expect(detail.isClosed).toBe(false);
    expect(detail.dDayLabel).toBe('D-8');
    expect(detail.category).toEqual({ name: '개발', slug: 'dev' });
  });

  it('CLOSED 공고 → JobDetail 반환 + isClosed true + dDayLabel null', async () => {
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(row({ status: 'CLOSED' }));
    const detail = await getJobDetail(1);
    expect(detail.status).toBe('CLOSED');
    expect(detail.isClosed).toBe(true);
    expect(detail.dDayLabel).toBeNull();
  });

  it('OPEN + closesAt < now → isClosed true (F-1 cron 미도입 가드)', async () => {
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(row({ status: 'OPEN' }));
    const detail = await getJobDetail(1);
    expect(detail.status).toBe('OPEN');
    expect(detail.isClosed).toBe(true);
  });

  it('closesAt null (상시모집) → dDayLabel "상시모집" + isClosed false', async () => {
    vi.setSystemTime(new Date('2026-05-24T00:00:00Z'));
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(row({ closesAt: null }));
    const detail = await getJobDetail(1);
    expect(detail.closesAt).toBeNull();
    expect(detail.isClosed).toBe(false);
    expect(detail.dDayLabel).toBe('상시모집');
  });

  it('select.questions where: { archivedAt: null } 강제 (L-015 R1 회귀 가드)', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(row());
    await getJobDetail(1);
    const callArg = basePrisma.jobPosting.findUnique.mock.calls[0]![0];
    expect(callArg.where).toEqual({ id: 1 });
    expect(callArg.select.questions.where).toEqual({ archivedAt: null });
    expect(callArg.select.questions.orderBy).toEqual([{ sortOrder: 'asc' }, { id: 'asc' }]);
    // view_count select 미포함 — Prometheus counter 위임 (CANDID-027)
    expect(Object.keys(callArg.select)).not.toContain('viewCount');
  });

  it('questions 정렬 + options 변환', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(
      row({
        questions: [
          {
            id: 11,
            questionText: '경력 기간',
            questionType: 'SHORT_TEXT',
            required: true,
            maxLength: 100,
            optionsJson: null,
            sortOrder: 1,
          },
          {
            id: 12,
            questionText: '관심 분야',
            questionType: 'MULTI_SELECT',
            required: false,
            maxLength: null,
            optionsJson: ['BE', 'FE'],
            sortOrder: 2,
          },
        ],
      }),
    );
    const detail = await getJobDetail(1);
    expect(detail.questions).toHaveLength(2);
    expect(detail.questions[0]!.id).toBe(11);
    expect(detail.questions[0]!.options).toBeNull();
    expect(detail.questions[1]!.options).toEqual(['BE', 'FE']);
    expect(detail.questions[1]!.required).toBe(false);
  });
});

describe('getJobDetail — sanitize 출력 시점 이중 방어', () => {
  it('<script> 태그 strip', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(
      row({ contentHtml: '<p>본문</p><script>alert(1)</script>' }),
    );
    const detail = await getJobDetail(1);
    expect(detail.contentHtmlSanitized).not.toMatch(/<script/i);
    expect(detail.contentHtmlSanitized).toMatch(/<p>본문<\/p>/);
  });

  it('javascript: URI 차단', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(
      row({ contentHtml: '<a href="javascript:alert(1)">click</a>' }),
    );
    const detail = await getJobDetail(1);
    // href는 strip되거나 anchor 자체가 제거됨 — 어느 쪽이든 javascript: 노출 금지
    expect(detail.contentHtmlSanitized.toLowerCase()).not.toContain('javascript:');
  });

  it('정상 인라인 태그는 통과', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(
      row({ contentHtml: '<p><strong>안녕</strong> <em>세상</em></p>' }),
    );
    const detail = await getJobDetail(1);
    expect(detail.contentHtmlSanitized).toMatch(/<strong>안녕<\/strong>/);
    expect(detail.contentHtmlSanitized).toMatch(/<em>세상<\/em>/);
  });
});

describe('getJobDetail — 404 분기', () => {
  it('존재하지 않음 → JOB_NOT_FOUND throw', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue(null);
    const error = await getJobDetail(999).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('DRAFT 비공개 → JOB_NOT_FOUND throw (서비스 레이어 분기, where 필터 ✗)', async () => {
    basePrisma.jobPosting.findUnique.mockResolvedValue(row({ status: 'DRAFT' }));
    const error = await getJobDetail(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'JOB_NOT_FOUND' });
    // where 절에 status 필터 미포함 — 어드민 미리보기 확장성 보존
    const callArg = basePrisma.jobPosting.findUnique.mock.calls[0]![0];
    expect(callArg.where).toEqual({ id: 1 });
  });
});
