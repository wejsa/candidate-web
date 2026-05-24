// CANDID-013 Step 1 — 공고 목록 조회 서비스 (US-JOB-001).
// - zod 스키마로 query 검증 (잘못된 enum/페이지 → SYS_VALIDATION_FAILED)
// - 활성(OPEN) 공고: 필터/정렬/페이징 + 마감 미리보기(page=1)
// - unstable_cache 60초 TTL + 'jobs-list' 태그 (어드민 발행/마감 시 revalidateTag로 무효화)
// - D-Day 라벨은 캐시 외부에서 매번 계산 (now() 기반이라 캐시 키에 포함 불가)

import 'server-only';
import { unstable_cache } from 'next/cache';
import { CareerLevel, EmploymentType, JobStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { basePrisma } from '@/lib/prisma';
import type {
  JobListItem,
  JobListPagination,
  JobListResponse,
  SortKey,
} from '@/lib/jobs/types';

export const PER_PAGE = 20;
export const MAX_PAGE = 50; // offset deep page 차단 (1000건 상한 — F-2 무한 스크롤은 후속 task)
export const CLOSED_PREVIEW_COUNT = 5;
export const CACHE_TTL_SECONDS = 60;
export const CACHE_TAG = 'jobs-list';

// 빈 문자열을 undefined로 변환 (URLSearchParams.get은 '' 반환 가능 — zod optional 통과시킴)
const blankToUndef = z
  .string()
  .transform((v) => (v.trim() === '' ? undefined : v))
  .optional();

const sortSchema = z
  .enum(['latest', 'deadline'])
  .optional()
  .default('latest');

// 'true'/'false' 문자열도 허용 (URLSearchParams에서 옴). 기본 true.
const includeClosedSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .default(true)
  .transform((v) => (typeof v === 'string' ? v === 'true' : v));

export const JobListQuerySchema = z.object({
  category: blankToUndef.pipe(z.string().min(1).max(80).optional()),
  employment: blankToUndef.pipe(z.nativeEnum(EmploymentType).optional()),
  career: blankToUndef.pipe(z.nativeEnum(CareerLevel).optional()),
  sort: sortSchema,
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional().default(1),
  includeClosed: includeClosedSchema,
});

export type ParsedJobListQuery = z.infer<typeof JobListQuerySchema>;

const cardSelect = {
  id: true,
  title: true,
  employmentType: true,
  careerLevel: true,
  opensAt: true,
  closesAt: true,
  jobCategory: { select: { name: true, slug: true } },
} satisfies Prisma.JobPostingSelect;

type CardRow = Prisma.JobPostingGetPayload<{ select: typeof cardSelect }>;

function buildActiveWhere(q: ParsedJobListQuery): Prisma.JobPostingWhereInput {
  const where: Prisma.JobPostingWhereInput = { status: JobStatus.OPEN };
  if (q.employment) where.employmentType = q.employment;
  if (q.career) where.careerLevel = q.career;
  if (q.category) where.jobCategory = { is: { slug: q.category } };
  return where;
}

function buildClosedWhere(q: ParsedJobListQuery): Prisma.JobPostingWhereInput {
  // 마감 섹션도 동일 필터를 따라간다 (사용자가 직군 필터 걸면 마감 섹션도 직군 한정).
  return { ...buildActiveWhere(q), status: JobStatus.CLOSED };
}

function buildOrderBy(sort: SortKey): Prisma.JobPostingOrderByWithRelationInput[] {
  if (sort === 'deadline') {
    // closesAt NULL(상시모집)은 항상 뒤. tie-break: id desc (안정 정렬).
    return [{ closesAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }];
  }
  return [{ opensAt: 'desc' }, { id: 'desc' }];
}

/**
 * 마감일 라벨 — 24시간 단위 floor.
 * - closesAt = null → '상시모집'
 * - closesAt < now → null (이미 마감)
 * - 0~24h → '오늘 마감'
 * - 24~48h → 'D-1'
 * - N*24 ~ (N+1)*24h → `D-${N}`
 *
 * 서버 시간대 차이(UTC vs KST 등) refinement는 F-1 자동 전이 cron과 함께 후속 task.
 */
export function computeDDay(closesAt: Date | null, now: Date): string | null {
  if (closesAt === null) return '상시모집';
  const diffMs = closesAt.getTime() - now.getTime();
  if (diffMs < 0) return null;
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 0) return '오늘 마감';
  return `D-${days}`;
}

function toCard(row: CardRow, now: Date): JobListItem {
  return {
    id: row.id,
    title: row.title,
    employmentType: row.employmentType,
    careerLevel: row.careerLevel,
    category: row.jobCategory,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    dDayLabel: computeDDay(row.closesAt, now),
  };
}

interface RawListData {
  activeRows: CardRow[];
  total: number;
  closedRows: CardRow[] | null;
}

// Prisma 호출만 캐시 — Date 직렬화/now() 의존성 회피.
// $extends된 prisma는 PII 변환을 위해 fn 안에서 다시 wrap되어 캐시 불일치 우려 → basePrisma 사용.
// JobPosting 모델은 PII 컬럼이 없으므로 raw client로도 충분.
async function fetchListData(q: ParsedJobListQuery): Promise<RawListData> {
  const activeWhere = buildActiveWhere(q);
  const orderBy = buildOrderBy(q.sort);
  const skip = (q.page - 1) * PER_PAGE;

  const [activeRows, total] = await Promise.all([
    basePrisma.jobPosting.findMany({
      where: activeWhere,
      orderBy,
      select: cardSelect,
      skip,
      take: PER_PAGE,
    }),
    basePrisma.jobPosting.count({ where: activeWhere }),
  ]);

  let closedRows: CardRow[] | null = null;
  if (q.page === 1 && q.includeClosed) {
    closedRows = await basePrisma.jobPosting.findMany({
      where: buildClosedWhere(q),
      orderBy: [{ closesAt: 'desc' }, { id: 'desc' }],
      select: cardSelect,
      take: CLOSED_PREVIEW_COUNT,
    });
  }

  return { activeRows, total, closedRows };
}

// 안정적인 캐시 키 — 필드 순서 고정, undefined는 생략.
function cacheKey(q: ParsedJobListQuery): string {
  return JSON.stringify({
    category: q.category ?? null,
    employment: q.employment ?? null,
    career: q.career ?? null,
    sort: q.sort,
    page: q.page,
    includeClosed: q.includeClosed,
  });
}

export async function listJobs(query: ParsedJobListQuery): Promise<JobListResponse> {
  const key = cacheKey(query);
  const cachedFetch = unstable_cache(() => fetchListData(query), [CACHE_TAG, key], {
    revalidate: CACHE_TTL_SECONDS,
    tags: [CACHE_TAG],
  });
  const { activeRows, total, closedRows } = await cachedFetch();
  const now = new Date();

  const totalPages = total === 0 ? 1 : Math.ceil(total / PER_PAGE);
  const pagination: JobListPagination = {
    page: query.page,
    perPage: PER_PAGE,
    total,
    totalPages,
    hasMore: query.page < totalPages,
  };

  const items = activeRows.map((r) => toCard(r, now));
  const response: JobListResponse = { items, pagination };
  if (closedRows && closedRows.length > 0) {
    response.closedItems = closedRows.map((r) => toCard(r, now));
  }
  return response;
}
