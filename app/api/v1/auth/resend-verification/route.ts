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
  enforceUserRateLimit,
  withRateLimit,
} from '@/lib/security/rate-limit';

// CANDID-010 Step 3 — POST /api/v1/auth/resend-verification.
// CANDID-036 보강:
//   - 인증 필수 (requireAuth) — 익명 사용자가 임의 사용자 메일 폭주 시도 차단.
//   - 다층 rate limit (PR #33 H004):
//     • IP 기준 withRateLimit(SIGNUP) — 5회/시간/IP (CANDID-009)
//     • userId 기준 enforceUserRateLimit(RESEND_VERIFICATION_USER) — 3회/시간/user
//     IP 회전 공격 + 같은 피해자 userId 매칭으로 메일 폭주 시도 자연 차단.
//   - DB 60s 쿨다운 + uk_email_verifications_active_per_user 부분 UNIQUE — 세 번째/네 번째 방어선.
//
// CANDID-037 Step 3 — wrapper 합성 일관화:
//   기존 `withUserRateLimit(USER_POLICIES.RESEND_VERIFICATION_USER, userId, ...)(req, ctx)` IIFE
//   패턴을 `enforceUserRateLimit` 인라인 헬퍼로 교체. 외부 `withRateLimit` + L-023 헤더 가드
//   결합으로 정상 path에는 inner(user-bucket) 정책명이 우선 노출되어 운영 메트릭/표준 backoff에
//   정확한 정보 전달. resendVerificationEmail은 진입부에 user 가드를 갖춰
//   USER_NOT_FOUND / AUTH_EMAIL_ALREADY_VERIFIED를 throw — withErrorHandler가 표준 7필드 응답으로 변환.

export const POST = withErrorHandler(
  withRateLimit(POLICIES.SIGNUP, async (request: NextRequest) => {
    const { userId } = await requireAuth(request);

    // L-023 인라인 user-bucket RL — limited 시 429 즉시 반환, 정상 시 attachHeaders로 응답에 부착.
    const userRateLimit = enforceUserRateLimit(
      USER_POLICIES.RESEND_VERIFICATION_USER,
      userId,
      request,
    );
    if (userRateLimit.response !== null) return userRateLimit.response;

    const result = await resendVerificationEmail(userId);

    // 사용자 정보 조회 (이메일/이름 — 메일 발송용). 진입 가드에서 user 존재는 검증되었으나
    // 트랜잭션 사이 race로 deletion 가능 — fire-and-forget 분기에서 null 안전 처리.
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

    const response = NextResponse.json(
      { nextResendAvailableAt: result.nextResendAvailableAt.toISOString() },
      { status: 200 },
    );
    // L-023: inner(user-bucket) 헤더를 먼저 부착 → 외부 withRateLimit이 후속 set 가드.
    userRateLimit.attachHeaders(response);
    return response;
  }),
);
