import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { devVerifyEmailNow } from '@/lib/auth/email-verification';
import { getEnv } from '@/lib/env';
import { withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';

// prisma 사용 → Node 런타임.
export const runtime = 'nodejs';

// 개발 전용 — POST /api/v1/auth/dev-verify-email.
// 로컬 메일 캐처(maildev) 환경에서 메일 링크 클릭 없이 현재 로그인 사용자의 이메일 인증을
// 즉시 완료 처리한다(프로필의 "개발용: 즉시 인증 처리" 버튼이 호출).
//
// ⚠️ production에서는 라우트 자체가 없는 것처럼 404로 차단한다 — 이메일 소유 증명 없는
//    self-verify는 BR-AUTH-04 우회. getEnv() 가드 + devVerifyEmailNow 내부 가드 이중 차단.
export const POST = withErrorHandler(
  withTraceContext(async (request: NextRequest) => {
    if (getEnv().NODE_ENV === 'production') {
      return new NextResponse(null, { status: 404 });
    }
    const { userId } = await requireAuth(request);
    const result = await devVerifyEmailNow(userId);
    return NextResponse.json(
      {
        emailVerifiedAt: result.emailVerifiedAt.toISOString(),
        alreadyVerified: result.alreadyVerified,
      },
      { status: 200 },
    );
  }),
);
