// CANDID-014 Step 3 — 공고 상세 "지원하기" CTA 5-state 분기 (US-JOB-002).
// 우선순위:
//   1. job.isClosed (마감 우선) → 'CLOSED'
//   2. userId === null (비로그인) → 'GUEST'
//   3. application.result != WITHDRAWN (이미 지원) → 'ALREADY_APPLIED'
//   4. draft 존재 → 'RESUME_DRAFT'
//   5. 그 외 → 'APPLY'
//
// DB 조회:
//   - uk_applications_active (user_id, job_posting_id) WHERE result != 'WITHDRAWN' 부분 UNIQUE 활용
//   - uk_drafts_user_posting (user_id, job_posting_id) UNIQUE
//   - Promise.all 병렬 — round-trip 1회

import 'server-only';
import { ApplicationResult } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import type { JobDetail } from '@/lib/jobs/types';

export type ApplyCtaState =
  | 'GUEST'
  | 'APPLY'
  | 'RESUME_DRAFT'
  | 'ALREADY_APPLIED'
  | 'CLOSED';

export interface ApplyCtaResult {
  state: ApplyCtaState;
  // ALREADY_APPLIED인 경우 마이페이지 링크에 사용할 식별자 (선택).
  applicationNumber?: string;
}

interface ResolveInput {
  userId: number | null;
  job: Pick<JobDetail, 'id' | 'isClosed'>;
}

/**
 * 5-state CTA 분기 결정. 마감/비로그인은 DB 조회 없이 즉시 분기.
 * 로그인 + 미마감 케이스만 application/draft 1쌍 병렬 조회.
 */
export async function resolveApplyCta({ userId, job }: ResolveInput): Promise<ApplyCtaResult> {
  // 1) 마감 우선 — 비로그인이어도 마감 노출은 동일.
  if (job.isClosed) return { state: 'CLOSED' };
  // 2) 비로그인 — DB 조회 회피.
  if (userId === null) return { state: 'GUEST' };

  // 3-5) 로그인 + 미마감 — application + draft 1쌍 병렬.
  const [application, draft] = await Promise.all([
    basePrisma.application.findFirst({
      where: {
        userId,
        jobPostingId: job.id,
        result: { not: ApplicationResult.WITHDRAWN },
      },
      select: { applicationNumber: true },
    }),
    basePrisma.applicationDraft.findUnique({
      where: { userId_jobPostingId: { userId, jobPostingId: job.id } },
      select: { id: true },
    }),
  ]);

  // 3) 이미 활성 지원서 존재 (WITHDRAWN은 위 where에서 제외됨).
  if (application !== null) {
    return { state: 'ALREADY_APPLIED', applicationNumber: application.applicationNumber };
  }
  // 4) 임시 저장 있음 → '이어서 작성하기'.
  if (draft !== null) return { state: 'RESUME_DRAFT' };
  // 5) 신규 지원.
  return { state: 'APPLY' };
}
