import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resendVerificationEmail } from '@/lib/auth/email-verification';
import { buildVerifyEmailMessage } from '@/lib/email/templates/verify-email';
import { sendMail } from '@/lib/email/transport';
import { prisma } from '@/lib/prisma';
import { withErrorHandler } from '@/lib/errors';
import { emailDomainOf, summarizeError } from '@/lib/logging/pii-safe';
import {
  POLICIES,
  USER_POLICIES,
  withRateLimit,
  withUserRateLimit,
} from '@/lib/security/rate-limit';

// CANDID-010 Step 3 — POST /api/v1/auth/resend-verification.
// CANDID-036 보강:
//   - 인증 필수 (requireAuth) — 익명 사용자가 임의 사용자 메일 폭주 시도 차단.
//   - 다층 rate limit (PR #33 H004):
//     • IP 기준 withRateLimit(SIGNUP) — 5회/시간/IP (CANDID-009)
//     • userId 기준 withUserRateLimit(RESEND_VERIFICATION_USER) — 3회/시간/user
//     IP 회전 공격 + 같은 피해자 userId 매칭으로 메일 폭주 시도 자연 차단.
//   - DB 60s 쿨다운 (lib/auth/email-verification.ts) — 세 번째 방어선.

export const POST = withErrorHandler(
  withRateLimit(POLICIES.SIGNUP, async (request: NextRequest, context: unknown) => {
    // requireAuth가 AppError throw 시 withErrorHandler가 표준 401/403 응답으로 변환.
    const { userId } = await requireAuth(request);

    // userId-bucket rate limit (PR #33 H004 — IP 회전 공격에도 user 단위 제한 유지).
    return withUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, userId, async () => {
      const result = await resendVerificationEmail(userId);

      // 사용자 정보 조회 (이메일/이름 — 메일 발송용)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      if (user !== null) {
        const mailMsg = buildVerifyEmailMessage({
          to: user.email,
          name: user.name,
          token: result.verificationToken,
        });
        // fire-and-forget (BR-TX-02) — 발송 실패는 가입 직후 재발송으로 회복.
        void sendMail(mailMsg).catch((err) => {
          // CANDID-036: 인라인 redact를 lib/logging/pii-safe로 추출 — 횡단 관심사.
          console.error('[resend-verification] email send failed', {
            userId,
            emailDomain: emailDomainOf(user.email),
            ...summarizeError(err),
          });
        });
      }

      return NextResponse.json(
        { nextResendAvailableAt: result.nextResendAvailableAt.toISOString() },
        { status: 200 },
      );
    })(request, context);
  }),
);
