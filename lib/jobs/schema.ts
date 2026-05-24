// CANDID-013 Step 3 — 공고 목록 query 스키마 + 공용 상수 (server/client 양쪽 사용).
// JobFilters(client)와 listJobs(server) 모두 import. 'server-only' 마킹 없음 — Prisma/Next 캐시 의존 없음.
// list.ts는 본 모듈을 re-export하여 단일 import 경로 유지.

import { CareerLevel, EmploymentType } from '@prisma/client';
import { z } from 'zod';

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

const sortSchema = z.enum(['latest', 'deadline']).optional().default('latest');

// 'true'/'false' 문자열도 허용 (URLSearchParams에서 옴). 기본 true.
const includeClosedSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .default(true)
  .transform((v) => (typeof v === 'string' ? v === 'true' : v));

// PR #47 보안 리뷰 S-1: category 자유 문자열은 unstable_cache 키 폭증 표면 →
// JobCategory.slug 실제 형식과 동일한 [a-z0-9-]+ regex로 좁힘.
// 미매칭 입력은 400 SYS_VALIDATION_FAILED로 거부 → 캐시 오염 차단.
const slugSchema = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'invalid slug format');

export const JobListQuerySchema = z.object({
  category: blankToUndef.pipe(slugSchema.optional()),
  employment: blankToUndef.pipe(z.nativeEnum(EmploymentType).optional()),
  career: blankToUndef.pipe(z.nativeEnum(CareerLevel).optional()),
  sort: sortSchema,
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional().default(1),
  includeClosed: includeClosedSchema,
});

export type ParsedJobListQuery = z.infer<typeof JobListQuerySchema>;
