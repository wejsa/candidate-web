// CANDID-014 Step 1 — GET /api/v1/job-postings/{id} (US-JOB-002 공고 상세 조회).
//
// 보안 컨트롤:
//   withErrorHandler — zod 실패 → SYS_VALIDATION_FAILED, AppError(JOB_NOT_FOUND) → 404
//   middleware (전역) — HTTPS / CORS / 보안 헤더 자동 적용
//   (rate-limit 미적용 — 비로그인 공개 조회 + 60s 캐시로 부하 흡수)
//
// 응답:
//   - 200: JobDetail
//   - 400 SYS_VALIDATION_FAILED: id가 정수 아님
//   - 404 JOB_NOT_FOUND: 존재하지 않음 또는 DRAFT 비공개
//   - 500 SYS_INTERNAL_ERROR: 예기치 못한 오류
//
// Runtime: isomorphic-dompurify가 jsdom 기반이라 Edge 미지원 → nodejs 명시.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withErrorHandler } from '@/lib/errors';
import { getJobDetail } from '@/lib/jobs/detail';

export const runtime = 'nodejs';

const ParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

interface RouteCtx {
  params: Promise<{ id: string }> | { id: string };
}

export const GET = withErrorHandler(async (_req: NextRequest, ctx: RouteCtx) => {
  // Next.js 15는 params가 Promise. 14는 동기. await로 양쪽 모두 지원.
  const raw = await ctx.params;
  const { id } = ParamsSchema.parse(raw);
  const job = await getJobDetail(id);
  return NextResponse.json(job, { status: 200 });
});
