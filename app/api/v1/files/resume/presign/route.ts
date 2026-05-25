// CANDID-016 Step 2 — POST /api/v1/files/resume/presign (US-APP-003).
//
// 호출 흐름: 클라이언트가 파일 선택 → 본 엔드포인트 호출 → 응답의 uploadUrl로 직접 S3 PUT → confirm.
// 보안 컨트롤:
//   middleware (전역) — HTTPS / CORS / Rate Limit
//   requireAuth — 인증 실패 → AUTH_TOKEN_*
//   withErrorHandler — zod 실패 → SYS_VALIDATION_FAILED, AppError → 표준 응답
//
// Runtime: Prisma + AWS SDK → nodejs.

import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withErrorHandler } from '@/lib/errors';
import { PresignRequestSchema } from '@/lib/files/validation';
import { issueResumePresign } from '@/lib/files/resume';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(async (request: NextRequest) => {
  const auth = await requireAuth(request);
  const body = PresignRequestSchema.parse(await request.json());

  const result = await issueResumePresign({ userId: auth.userId, request: body });

  return NextResponse.json(
    {
      uploadUrl: result.uploadUrl,
      storedPath: result.storedPath,
      headers: result.headers,
      expiresAt: result.expiresAt.toISOString(),
      replacedPaths: result.replacedPaths,
    },
    {
      status: 200,
      // presigned URL은 단일 사용자 임시 발급 — CDN/프록시 캐싱 차단.
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
});
