import { NextResponse, type NextRequest } from 'next/server';
import { consumeVerificationToken } from '@/lib/auth/email-verification';
import { VerifyEmailInputSchema } from '@/lib/auth/validation';
import { withErrorHandler } from '@/lib/errors';

// CANDID-010 Step 3 — POST /api/v1/auth/verify-email (US-AUTH-001).
// 인증 토큰을 받아 user.emailVerifiedAt + emailVerification.consumedAt을 원자 갱신.
// 미인증 사용자도 접근 가능(BR-AUTH-04) — Rate Limit은 본 라우터 미적용
// (이메일 인증 클릭은 빈번하지 않고, 토큰 entropy 256-bit로 brute force 무의미).

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = VerifyEmailInputSchema.parse(await request.json());
  const result = await consumeVerificationToken(body.token);
  return NextResponse.json(
    {
      emailVerifiedAt: result.emailVerifiedAt.toISOString(),
      // 멱등 응답 — 이미 인증 완료된 토큰을 재클릭한 경우 true.
      alreadyVerified: result.alreadyVerified,
    },
    { status: 200 },
  );
});
