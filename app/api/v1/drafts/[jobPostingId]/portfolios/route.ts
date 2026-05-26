// CANDID-017 Step 2 — GET / PUT /api/v1/drafts/{jobPostingId}/portfolios (US-APP-004).
//
// GET: Draft의 portfolio link 목록 조회 (sortOrder 오름차순)
// PUT: replace strategy로 전체 교체 (max 5, BR-LINK-04)
//
// 보안 컨트롤:
//   requireAuth — 인증 실패 → AUTH_TOKEN_*
//   withErrorHandler — zod 실패 → SYS_VALIDATION_FAILED, AppError → 표준 응답
//   service 내부 — Draft 미존재/권한 위반 → APP_DRAFT_NOT_FOUND (정보 누출 차단)
//   middleware (전역) — HTTPS / CORS / 보안 헤더
//
// Runtime: Prisma client 사용 → nodejs.

import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withErrorHandler } from '@/lib/errors';
import {
  JobPostingIdParamSchema,
  PortfolioLinksRequestSchema,
} from '@/lib/portfolios/schema';
import { listByDraft, replaceForDraft } from '@/lib/portfolios/service';
import type { PortfolioLinksResponse } from '@/lib/portfolios/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ jobPostingId: string }> | { jobPostingId: string };
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: RouteCtx) => {
  const auth = await requireAuth(request);
  const raw = await ctx.params;
  const { jobPostingId } = JobPostingIdParamSchema.parse(raw);

  const links = await listByDraft({ userId: auth.userId, jobPostingId });
  const body: PortfolioLinksResponse = { links };
  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});

export const PUT = withErrorHandler(async (request: NextRequest, ctx: RouteCtx) => {
  const auth = await requireAuth(request);
  const raw = await ctx.params;
  const { jobPostingId } = JobPostingIdParamSchema.parse(raw);

  const json: unknown = await request.json();
  const parsed = PortfolioLinksRequestSchema.parse(json);

  const links = await replaceForDraft({
    userId: auth.userId,
    jobPostingId,
    links: parsed.links,
  });
  const body: PortfolioLinksResponse = { links };
  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
