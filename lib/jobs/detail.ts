// CANDID-014 Step 1 — 공고 상세 조회 서비스 (US-JOB-002).
// - findUnique PK 조회 + 1 hop relation (jobCategory + questions) 단일 round-trip
// - DRAFT 공고는 서비스 레이어에서 404 매핑 (어드민 미리보기 확장성 보존)
// - JobPostingQuestion은 archived_at IS NULL 강제 (L-015 R1 SSOT)
// - sanitizeHtml은 unstable_cache 콜백 *내부*에서 적용 → 60s 캐시 윈도우 안 1회만 수행
// - isClosed는 캐시 외부에서 동적 계산 (now() 의존 — F-1 cron 미도입 가드)
// - view_count은 다루지 않음 (CANDID-027 Prometheus counter 위임)

import 'server-only';
import { unstable_cache } from 'next/cache';
import { JobStatus, type Prisma } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { sanitizeHtml } from '@/lib/security/sanitize';
import { computeDDay } from '@/lib/jobs/dday';
import type { JobDetail, JobQuestion } from '@/lib/jobs/types';

const DETAIL_CACHE_TAG_PREFIX = 'jobs-detail';
const DETAIL_CACHE_TTL_SECONDS = 60;

export function detailCacheTag(id: number): string {
  return `${DETAIL_CACHE_TAG_PREFIX}-${id}`;
}

const detailSelect = {
  id: true,
  title: true,
  employmentType: true,
  careerLevel: true,
  contentHtml: true,
  opensAt: true,
  closesAt: true,
  status: true,
  jobCategory: { select: { name: true, slug: true } },
  questions: {
    // L-015 R1: archived 질문은 후보자에게 노출 금지. select 단계에서 강제.
    where: { archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      questionText: true,
      questionType: true,
      required: true,
      maxLength: true,
      optionsJson: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.JobPostingSelect;

type DetailRow = Prisma.JobPostingGetPayload<{ select: typeof detailSelect }>;

// 캐시 가능한 직렬화 가능 형태 — Date는 string, sanitize도 여기서 적용.
interface CachedDetailData {
  id: number;
  title: string;
  employmentType: DetailRow['employmentType'];
  careerLevel: DetailRow['careerLevel'];
  category: { name: string; slug: string };
  contentHtmlSanitized: string;
  opensAtIso: string;
  closesAtIso: string | null;
  status: 'OPEN' | 'CLOSED';
  questions: JobQuestion[];
}

function toQuestion(q: DetailRow['questions'][number]): JobQuestion {
  return {
    id: q.id,
    questionText: q.questionText,
    questionType: q.questionType,
    required: q.required,
    maxLength: q.maxLength,
    options: q.optionsJson ?? null,
    sortOrder: q.sortOrder,
  };
}

async function fetchDetailData(id: number): Promise<CachedDetailData | null> {
  const row = await basePrisma.jobPosting.findUnique({
    where: { id },
    select: detailSelect,
  });
  if (row === null) return null;
  // DRAFT는 비공개 — 서비스 레이어에서 null 처리 (캐시 외부에서 404로 매핑).
  if (row.status === JobStatus.DRAFT) return null;
  return {
    id: row.id,
    title: row.title,
    employmentType: row.employmentType,
    careerLevel: row.careerLevel,
    category: row.jobCategory,
    contentHtmlSanitized: sanitizeHtml(row.contentHtml, 'job-posting'),
    opensAtIso: row.opensAt.toISOString(),
    closesAtIso: row.closesAt === null ? null : row.closesAt.toISOString(),
    status: row.status,
    questions: row.questions.map(toQuestion),
  };
}

/**
 * 공고 단건을 조회한다.
 *
 * - PK 조회 → findUnique 1회. unstable_cache(60s)로 동일 id 트래픽 흡수.
 * - 존재하지 않거나 DRAFT 상태이면 `JOB_NOT_FOUND` AppError를 throw한다.
 * - 응답의 `isClosed` / `dDayLabel`은 now() 의존이라 캐시 외부에서 동적 계산.
 *
 * 호출자는 Route Handler를 `withErrorHandler`로 감싸 throw된 AppError가 표준 응답으로 변환되게 한다.
 */
export async function getJobDetail(id: number): Promise<JobDetail> {
  const tag = detailCacheTag(id);
  // CANDID-014 Step 2 L-019 (D-MAJOR-1): 키 배열에 id를 명시 — list.ts 패턴과 일관화.
  // 향후 시그니처 확장(locale 등) 시 키 누락 회귀 가드.
  const cachedFetch = unstable_cache(() => fetchDetailData(id), [DETAIL_CACHE_TAG_PREFIX, String(id)], {
    revalidate: DETAIL_CACHE_TTL_SECONDS,
    tags: [tag],
  });
  const data = await cachedFetch();
  if (data === null) {
    throw new AppError('JOB_NOT_FOUND');
  }
  const now = new Date();
  const closesAt = data.closesAtIso === null ? null : new Date(data.closesAtIso);
  const isClosed =
    data.status === 'CLOSED' || (closesAt !== null && closesAt.getTime() <= now.getTime());
  return {
    id: data.id,
    title: data.title,
    employmentType: data.employmentType,
    careerLevel: data.careerLevel,
    category: data.category,
    contentHtmlSanitized: data.contentHtmlSanitized,
    opensAt: new Date(data.opensAtIso),
    closesAt,
    status: data.status,
    isClosed,
    dDayLabel: computeDDay(closesAt, now),
    questions: data.questions,
  };
}
