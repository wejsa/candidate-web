// CANDID-015 Step 1 — GET / PUT /api/v1/drafts/{jobPostingId} (US-APP-005).
//
// GET: Draft 진입 (없으면 초기 payload 생성) + User PII prefill (Step 2에서 추가)
// PUT: 자동/수동 저장 — 낙관적 락 (body.version)
// DELETE: 작성 중 Draft 폐기 (작성 취소) — 첨부 S3 + portfolio_links 정리. 멱등(204).
//
// 보안 컨트롤:
//   requireAuth — 인증 실패 → AUTH_TOKEN_*
//   withErrorHandler — zod 실패 → SYS_VALIDATION_FAILED, AppError → 표준 응답
//   middleware (전역) — HTTPS / CORS / 보안 헤더
//
// Runtime: Prisma client 사용 → nodejs.

import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withErrorHandler } from '@/lib/errors';
import { JobPostingIdParamSchema, DraftPutRequestSchema } from '@/lib/drafts/schema';
import { getOrInitDraft, upsertDraft, discardDraft } from '@/lib/drafts/service';
import { loadUserPrefill, assertUserMinAge } from '@/lib/drafts/user-prefill';
import type { DraftGetResponse, DraftPayloadV1, DraftPutResponse } from '@/lib/drafts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ jobPostingId: string }> | { jobPostingId: string };
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: RouteCtx) => {
  const auth = await requireAuth(request);
  const raw = await ctx.params;
  const { jobPostingId } = JobPostingIdParamSchema.parse(raw);

  // CANDID-015 Step 3 L-019 (D-MAJOR-1): User 존재 선검증 → Draft 진입 순차 호출.
  // Promise.all 병렬 시 loadUserPrefill 실패 + getOrInitDraft INSERT 부수효과로 고아 Draft 잔존
  // (idempotent 자가 치유이지만 운영 디버그 비용). 5ms 손실 trade-off 수용.
  const prefill = await loadUserPrefill(auth.userId);
  const { draft } = await getOrInitDraft(auth.userId, jobPostingId);

  const body: DraftGetResponse = {
    payload: draft.payloadJson as unknown as DraftPayloadV1,
    prefill,
    version: draft.version,
    lastSavedAt: draft.lastSavedAt.toISOString(),
  };
  // SECURITY (S-MAJOR-2 fix): prefill 평문 PII → 중간 캐싱 차단.
  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});

export const PUT = withErrorHandler(async (request: NextRequest, ctx: RouteCtx) => {
  const auth = await requireAuth(request);
  const raw = await ctx.params;
  const { jobPostingId } = JobPostingIdParamSchema.parse(raw);

  const rawBody = (await request.json()) as unknown;
  const { payload, version } = DraftPutRequestSchema.parse(rawBody);

  // CANDID-015 Step 3 L-019 (S-MAJOR-3, T-MAJOR-2): step1_personal 포함 시 만 14세 server-side
  // cross-check (BR-PII-05 3-layer). zod refine(Draft 입력)에 더해 User 원본 birthDate와 교차.
  if (payload.step1_personal !== undefined) {
    await assertUserMinAge(auth.userId);
  }

  const result = await upsertDraft({
    userId: auth.userId,
    jobPostingId,
    payload,
    expectedVersion: version,
  });

  const body: DraftPutResponse = {
    version: result.version,
    lastSavedAt: result.lastSavedAt.toISOString(),
  };
  return NextResponse.json(body, { status: 200 });
});

export const DELETE = withErrorHandler(async (request: NextRequest, ctx: RouteCtx) => {
  const auth = await requireAuth(request);
  const raw = await ctx.params;
  const { jobPostingId } = JobPostingIdParamSchema.parse(raw);

  // 본인 소유 draft 폐기 (멱등). 첨부 S3 + portfolio_links 정리는 service가 처리.
  await discardDraft(auth.userId, jobPostingId);

  return new NextResponse(null, { status: 204 });
});
