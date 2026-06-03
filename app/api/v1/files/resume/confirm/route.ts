// CANDID-016 Step 2 — POST /api/v1/files/resume/confirm (US-APP-003).
//
// 호출 흐름: 클라이언트가 S3 PUT 성공 → 본 엔드포인트 호출 → ResumeFile 메타 등록 (PENDING).
// 보안 컨트롤:
//   middleware (전역) — HTTPS / CORS / Rate Limit
//   requireAuth — 인증 실패 → AUTH_TOKEN_*
//   withErrorHandler — zod 실패 → SYS_VALIDATION_FAILED, AppError → 표준 응답
//   partial UNIQUE (D-MAJOR-2 fix) — 동시 탭 race → 409 FILE_ALREADY_EXISTS
//
// Runtime: Prisma → nodejs.

import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withErrorHandler } from '@/lib/errors';
import { ConfirmRequestSchema } from '@/lib/files/validation';
import { confirmResumeUpload } from '@/lib/files/confirm';
import { withBusinessMetric } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(
  withBusinessMetric('file_upload', async (request: NextRequest) => {
    const auth = await requireAuth(request);
    const body = ConfirmRequestSchema.parse(await request.json());

    const result = await confirmResumeUpload({ userId: auth.userId, request: body });

    return NextResponse.json(
      {
        id: result.id,
        virusScanStatus: result.virusScanStatus,
        uploadedAt: result.uploadedAt.toISOString(),
      },
      {
        status: 201,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }),
);
