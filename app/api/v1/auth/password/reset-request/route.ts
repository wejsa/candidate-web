import { NextResponse, type NextRequest } from 'next/server';
import { requestPasswordReset } from '@/lib/auth/password-reset';
import { buildResetPasswordMessage } from '@/lib/email/templates/reset-password';
import { sendMail } from '@/lib/email/transport';
import { PasswordResetRequestInputSchema } from '@/lib/auth/validation';
import { withErrorHandler } from '@/lib/errors';
import { emailDomainOf, summarizeError } from '@/lib/logging/pii-safe';
import { POLICIES, withRateLimit } from '@/lib/security/rate-limit';

// CANDID-020 Step 2 — POST /api/v1/auth/password/reset-request (US-AUTH-004).
//
// 비인증 엔드포인트 (비밀번호를 잊은 사용자). 보안 컨트롤:
//   withRateLimit(POLICIES.PASSWORD_RESET) — 5회/시간/IP (토큰/메일 폭주 + 열거 탐침 차단)
//   withErrorHandler — ZodError/AppError → 표준 7필드 응답 변환
//   middleware (전역) — HTTPS / CORS / CSRF Origin / 보안 헤더
//
// 계정 열거 방지(핵심): 이메일 존재 여부·상태와 무관하게 **항상 동일한 200 응답**을 반환한다.
//   - 적격 사용자: 토큰 발급(서비스) + 재설정 메일 fire-and-forget(BR-TX-02)
//   - 비적격(미존재/LOCKED/WITHDRAWN/소셜전용/동시발급 race): 메일 미발송, 동일 응답
//   - 미존재 이메일을 로그/감사로 남기지 않음 (로그 사이드채널 차단)
//   - 형식 오류(유효하지 않은 이메일)는 계정 존재와 무관한 입력 결함이므로 400(SYS_VALIDATION_FAILED)

/** 적격/비적격 무관 동일 안내 — 계정 존재 여부를 노출하지 않는다. */
const UNIFORM_MESSAGE =
  '입력하신 이메일이 가입되어 있다면 비밀번호 재설정 안내 메일을 보냈습니다. 잠시 후 메일함을 확인해 주세요.';

export const POST = withErrorHandler(
  withRateLimit(POLICIES.PASSWORD_RESET, async (request: NextRequest) => {
    // ZodError는 withErrorHandler가 표준 응답으로 변환 (400). 이메일 형식 오류는 열거와 무관.
    const { email } = PasswordResetRequestInputSchema.parse(await request.json());

    const result = await requestPasswordReset(email);

    if (result !== null) {
      // 메일은 트랜잭션 외부 fire-and-forget (BR-TX-02) — 응답을 막지 않고 타이밍을 균일하게 유지.
      const mailMsg = buildResetPasswordMessage({
        to: result.email,
        name: result.name,
        token: result.resetToken,
      });
      void sendMail(mailMsg).catch((err) => {
        // 평문 이메일/토큰 노출 차단 — 도메인만 로깅 + 에러 요약(pii-safe).
        console.error('[password-reset-request] email send failed', {
          emailDomain: emailDomainOf(result.email),
          ...summarizeError(err),
        });
      });
    }

    // 항상 동일 200 (계정 열거 방지). 발급/발송 여부를 응답으로 구분하지 않는다.
    return NextResponse.json({ message: UNIFORM_MESSAGE }, { status: 200 });
  }),
);
