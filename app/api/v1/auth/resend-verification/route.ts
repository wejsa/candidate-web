import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resendVerificationEmail } from '@/lib/auth/email-verification';
import { buildVerifyEmailMessage } from '@/lib/email/templates/verify-email';
import { sendMail } from '@/lib/email/transport';
import { prisma } from '@/lib/prisma';
import { withErrorHandler } from '@/lib/errors';
import { POLICIES, withRateLimit } from '@/lib/security/rate-limit';

// CANDID-010 Step 3 — POST /api/v1/auth/resend-verification.
// 60초 쿨다운(DB last_sent_at) + Rate Limit(IP 기준 보조 방어) 이중 가드.
// 인증 필수 — 익명 사용자가 임의 사용자 메일 폭주 시도 차단.

export const POST = withErrorHandler(
  withRateLimit(POLICIES.SIGNUP, async (request: NextRequest) => {
    // requireAuth가 AppError throw 시 withErrorHandler가 표준 401/403 응답으로 변환.
    const { userId } = await requireAuth(request);

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
        // PR #34 H002: signup 라우터와 동일 — err 객체째 펼침 시 envelope/response에
        // 평문 수신자 이메일 노출. errMessage도 nodemailer가 SMTP 응답 합성 가능.
        const rawMessage = err instanceof Error ? err.message : String(err);
        const safeMessage = rawMessage.replace(
          /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
          '<email-redacted>',
        );
        console.error('[resend-verification] email send failed', {
          userId,
          emailDomain: user.email.split('@')[1] ?? 'unknown',
          errName: err instanceof Error ? err.name : 'Unknown',
          errMessage: safeMessage,
          smtpResponseCode: (err as { responseCode?: number })?.responseCode ?? null,
        });
      });
    }

    return NextResponse.json(
      { nextResendAvailableAt: result.nextResendAvailableAt.toISOString() },
      { status: 200 },
    );
  }),
);
