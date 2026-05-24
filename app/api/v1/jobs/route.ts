// CANDID-013 Step 1 — GET /api/v1/jobs (US-JOB-001 채용 공고 목록).
//
// 보안 컨트롤:
//   withErrorHandler — zod 실패 → SYS_VALIDATION_FAILED, 그 외 throw → SYS_INTERNAL_ERROR
//   middleware (전역) — HTTPS / CORS / 보안 헤더 자동 적용
//   (rate-limit 미적용 — 비로그인 공개 조회 + 60s 캐시로 부하 충분히 흡수)
//
// 응답:
//   - 200: { items, closedItems?, pagination } — JobListResponse
//   - 400 SYS_VALIDATION_FAILED: 잘못된 enum/페이지/sort
//   - 500 SYS_INTERNAL_ERROR: 예기치 못한 오류

import { NextResponse, type NextRequest } from 'next/server';
import { withErrorHandler } from '@/lib/errors';
import { JobListQuerySchema, listJobs } from '@/lib/jobs/list';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const query = JobListQuerySchema.parse(raw);
  const data = await listJobs(query);
  return NextResponse.json(data, { status: 200 });
});
