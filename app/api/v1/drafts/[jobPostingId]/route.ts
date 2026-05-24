// CANDID-015 Step 1 — GET / PUT /api/v1/drafts/{jobPostingId} (US-APP-005).
//
// GET: Draft 진입 (없으면 초기 payload 생성) + User PII prefill (Step 2에서 추가)
// PUT: 자동/수동 저장 — 낙관적 락 (body.version)
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
import { getOrInitDraft, upsertDraft } from '@/lib/drafts/service';
import type {
  DraftGetResponse,
  DraftPayloadV1,
  DraftPrefill,
  DraftPutResponse,
} from '@/lib/drafts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ jobPostingId: string }> | { jobPostingId: string };
}

// Step 2에서 User PII 복호화 + 마스킹 통합. 본 step에서는 빈 prefill 반환.
const EMPTY_PREFILL: DraftPrefill = {
  email: '',
  name: null,
  phone: null,
  birthDate: null,
};

export const GET = withErrorHandler(async (request: NextRequest, ctx: RouteCtx) => {
  const auth = await requireAuth(request);
  const raw = await ctx.params;
  const { jobPostingId } = JobPostingIdParamSchema.parse(raw);

  const { draft } = await getOrInitDraft(auth.userId, jobPostingId);

  const body: DraftGetResponse = {
    payload: draft.payloadJson as unknown as DraftPayloadV1,
    prefill: EMPTY_PREFILL, // Step 2에서 User PII 복호화 결과로 대체
    version: draft.version,
    lastSavedAt: draft.lastSavedAt.toISOString(),
  };
  return NextResponse.json(body, { status: 200 });
});

export const PUT = withErrorHandler(async (request: NextRequest, ctx: RouteCtx) => {
  const auth = await requireAuth(request);
  const raw = await ctx.params;
  const { jobPostingId } = JobPostingIdParamSchema.parse(raw);

  const rawBody = (await request.json()) as unknown;
  const { payload, version } = DraftPutRequestSchema.parse(rawBody);

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
