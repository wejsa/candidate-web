// CANDID-013 Step 1 — 공고 목록 조회 서비스 (US-JOB-001).
// - zod 스키마로 query 검증 (잘못된 enum/페이지 → SYS_VALIDATION_FAILED)
// - 활성(OPEN) 공고: 필터/정렬/페이징 + 마감 미리보기(page=1)
// - unstable_cache 60초 TTL + 'jobs-list' 태그 (어드민 발행/마감 시 revalidateTag로 무효화)
// - D-Day 라벨은 캐시 외부에서 매번 계산 (now() 기반이라 캐시 키에 포함 불가)

import 'server-only';
import { unstable_cache } from 'next/cache';
import { JobStatus, type Prisma } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import {
  CACHE_TAG,
  CACHE_TTL_SECONDS,
  CLOSED_PREVIEW_COUNT,
  PER_PAGE,
  type ParsedJobListQuery,
} from '@/lib/jobs/schema';
// CANDID-014 Step 3 L-019 (D-MAJOR-3): 단일 import로 통합 (re-export + internal 중복 제거).
import { computeDDay } from '@/lib/jobs/dday';
import type { JobListItem, JobListPagination, JobListResponse, SortKey } from '@/lib/jobs/types';

// 본 모듈 사용자가 단일 경로(`@/lib/jobs/list`)로 schema를 가져올 수 있도록 re-export.
// 신규 client-only 코드는 직접 `@/lib/jobs/schema` import 권장 (server-only chain 차단).
export {
  CACHE_TAG,
  CACHE_TTL_SECONDS,
  CLOSED_PREVIEW_COUNT,
  JobListQuerySchema,
  MAX_PAGE,
  PER_PAGE,
} from '@/lib/jobs/schema';
export type { ParsedJobListQuery } from '@/lib/jobs/schema';
// CANDID-014 Step 2 L-019 (D-MAJOR-2): computeDDay는 lib/jobs/dday.ts SSOT.
// 본 모듈 기존 사용자가 깨지지 않도록 re-export 유지.
export { computeDDay };

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

// CANDID-049: unstable_cache는 캐시 결과를 JSON 직렬화하므로 캐시 히트 시 Date 컬럼이 string으로
// 되돌아온다(line 89의 "Date 직렬화 회피" 의도는 fetchListData 반환값 자체가 직렬화되어 무효).
// 그대로 computeDDay(closesAt.getTime())에 넘기면 string에 .getTime() 호출로 /jobs가 크래시한다.
// → 캐시 경계(toCard)에서 Date로 재수화한다. new Date(Date|string) 모두 안전.
// 테스트: tests/lib/jobs/list.test.ts가 JSON 라운드트립으로 직렬화 재현 후 본 함수를 직접 검증(L-003).
export function toCard(row: CardRow, now: Date): JobListItem {
  const opensAt = new Date(row.opensAt);
  const closesAt = row.closesAt === null ? null : new Date(row.closesAt);
  return {
    id: row.id,
    title: row.title,
    employmentType: row.employmentType,
    careerLevel: row.careerLevel,
    category: row.jobCategory,
    opensAt,
    closesAt,
    dDayLabel: computeDDay(closesAt, now),
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
