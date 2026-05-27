// CANDID-019 Step 1 — GET /api/v1/applications/me (US-MY-001).
//
// 미들웨어 chain:
//   withErrorHandler → requireAuth → getMyApplicationsList(userId) → 200 응답
//
// 응답: { drafts: MyDraftCard[], inProgress: MyApplicationCard[], closed: MyApplicationCard[] }
// PII-free: Application select 화이트리스트로 snapshot 5쌍 자동 제외 (L-006).

import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getMyApplicationsList } from '@/lib/my-page/list-service';
import { withErrorHandler } from '@/lib/errors';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { userId } = await requireAuth(request);
  const data = await getMyApplicationsList(userId);
  return NextResponse.json(data, { status: 200 });
});
