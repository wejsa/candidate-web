import { z } from 'zod';
import { StageType } from '@prisma/client';

// CANDID-053 Step 5 — 운영자 지원자 목록 쿼리 파라미터.
// page는 1-base, stage는 선택 필터(StageType). 그 외 파라미터는 무시.

export const ApplicantListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  stage: z.nativeEnum(StageType).optional(),
});

export type ApplicantListQuery = z.infer<typeof ApplicantListQuerySchema>;

/** URLSearchParams → 검증된 쿼리. 미지정/빈 값은 기본값으로 폴백. */
export function parseApplicantListQuery(searchParams: URLSearchParams): ApplicantListQuery {
  const stageRaw = searchParams.get('stage');
  return ApplicantListQuerySchema.parse({
    page: searchParams.get('page') ?? undefined,
    // 빈 문자열은 undefined로 정규화(미필터) — z.nativeEnum이 ''를 거부하는 것 방지.
    stage: stageRaw === null || stageRaw === '' ? undefined : stageRaw,
  });
}
