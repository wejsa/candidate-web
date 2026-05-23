import { NextResponse, type NextRequest } from 'next/server';
import { setAuthCookies } from '@/lib/auth/cookies';
import { createUserAndIssueTokens } from '@/lib/auth/signup';
import { SignupInputSchema } from '@/lib/auth/validation';
import { buildVerifyEmailMessage } from '@/lib/email/templates/verify-email';
import { sendMail } from '@/lib/email/transport';
import { withErrorHandler } from '@/lib/errors';
import { POLICIES, withRateLimit } from '@/lib/security/rate-limit';

// CANDID-010 Step 2 — POST /api/v1/auth/signup (US-AUTH-001).
// 보안 컨트롤 (CANDID-009 첫 실 부착):
//   withRateLimit(POLICIES.SIGNUP) — BR-SEC-04 (5회/시간/IP), 한도 초과 시 429
//   withErrorHandler — AppError → 표준 7필드 응답 변환 (USER_EMAIL_DUPLICATED 등)
//   middleware (전역) — HTTPS / CORS / CSRF Origin / 보안 헤더 자동 적용
//
// 응답: 201 + Set-Cookie(access_token, refresh_token) + user 정보(이메일/이름/emailVerifiedAt:null)
// 메일 발송은 트랜잭션 외부 fire-and-forget (BR-TX-02) — 발송 실패가 가입을 막지 않음.

export const POST = withErrorHandler(
  withRateLimit(POLICIES.SIGNUP, async (request: NextRequest) => {
    const body = SignupInputSchema.parse(await request.json());
    const result = await createUserAndIssueTokens(body, {
      userAgent: request.headers.get('user-agent'),
      // X-Forwarded-For 신뢰는 lib/security/rate-limit.ts와 동일 TRUST_PROXY 게이트로 별도 헬퍼화 가능 —
      // 현재는 단순화하여 null. CANDID-026 감사 로그에서 IP 추출 통일 예정.
      ipAddress: null,
    });

    // 메일 발송은 fire-and-forget (BR-TX-02) — 트랜잭션 밖, 가입 응답을 막지 않는다.
    const mailMsg = buildVerifyEmailMessage({
      to: result.user.email,
      name: result.user.name,
      token: result.verificationToken,
    });
    void sendMail(mailMsg).catch((err) => {
      // PR #33 H003 fix: 평문 email은 PII — 도메인만 남겨 디버깅 충분성과 PII 보호를 양립.
      console.error('[signup] verification email send failed', {
        userId: result.user.id,
        emailDomain: result.user.email.split('@')[1],
        errName: err instanceof Error ? err.name : 'Unknown',
        errMessage: err instanceof Error ? err.message : String(err),
      });
    });

    const response = NextResponse.json(
      {
        user: result.user,
        // Step 3 fix(Step 2 review D2): 응답 시점에는 메일 발송 *시도*만 완료(fire-and-forget).
        // 발송 결과(성공/실패)는 응답에 포함되지 않음. 미수신 시 재발송 API(/resend-verification).
        verificationEmailQueued: true,
      },
      { status: 201 },
    );
    setAuthCookies(response, {
      access: { token: result.tokens.accessToken, expiresAt: result.tokens.accessExpiresAt },
      refresh: { token: result.tokens.refreshToken, expiresAt: result.tokens.refreshExpiresAt },
    });
    return response;
  }),
);
