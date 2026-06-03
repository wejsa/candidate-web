import { NextResponse, type NextRequest } from 'next/server';
import { consumeVerificationToken } from '@/lib/auth/email-verification';
import { VerifyEmailInputSchema } from '@/lib/auth/validation';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';
import { POLICIES, withRateLimit } from '@/lib/security/rate-limit';

// prisma(consumeVerificationToken) 사용 → Node 런타임. withTraceContext로 감사 emit에 traceId 전파.
export const runtime = 'nodejs';

// CANDID-010 Step 3 — POST /api/v1/auth/verify-email (US-AUTH-001).
// 인증 토큰을 받아 user.emailVerifiedAt + emailVerification.consumedAt을 race-free 갱신.
// 미인증 사용자도 접근 가능(BR-AUTH-04).
//
// CANDID-036 (PR #33 H005): VERIFY_EMAIL Rate Limit 부착.
// 256-bit entropy로 brute force는 무의미하나, 무제한 POST 허용 시 다음 abuse 가능:
//   - 유효 형식 토큰 다량 POST → DB lookup 폭주 (DoS)
//   - 로그 폭주
// NAT 환경 다수 사용자 동시 클릭 여유 확보 (30회/분/IP = 1초당 0.5회).

export const POST = withErrorHandler(
  withTraceContext(
    withRateLimit(POLICIES.VERIFY_EMAIL, async (request: NextRequest) => {
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
    }),
  ),
);
