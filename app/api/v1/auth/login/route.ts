import { NextResponse, type NextRequest } from 'next/server';
import { setAuthCookies } from '@/lib/auth/cookies';
import { signin } from '@/lib/auth/login';
import { LoginInputSchema } from '@/lib/auth/validation';
import { withErrorHandler } from '@/lib/errors';
import { POLICIES, withRateLimit } from '@/lib/security/rate-limit';

// CANDID-011 Step 2 — POST /api/v1/auth/login (US-AUTH-002).
// 보안 컨트롤:
//   withRateLimit(POLICIES.LOGIN) — BR-SEC-04 (10회/분/IP), 한도 초과 시 429
//   withErrorHandler — AppError → 표준 7필드 응답 변환 (AUTH_INVALID_CREDENTIALS, AUTH_ACCOUNT_LOCKED)
//   middleware (전역) — HTTPS / CORS / CSRF Origin / 보안 헤더 자동 적용
//
// 응답:
//   - 200: Set-Cookie(access_token, refresh_token) + user 정보 (id/email/name/emailVerifiedAt)
//   - 401 AUTH_INVALID_CREDENTIALS: 이메일/비밀번호 불일치 (계정 열거 방지 — 동일 응답)
//   - 429 AUTH_ACCOUNT_LOCKED: 5회 실패 후 15분 잠금
//   - 429 SYS_RATE_LIMITED: IP 한도 초과
//   - 400 SYS_VALIDATION_FAILED: Zod 입력 검증 실패

export const POST = withErrorHandler(
  withRateLimit(POLICIES.LOGIN, async (request: NextRequest) => {
    const body = LoginInputSchema.parse(await request.json());

    const result = await signin(body, {
      userAgent: request.headers.get('user-agent'),
      // X-Forwarded-For 신뢰는 lib/security/rate-limit.ts와 동일 TRUST_PROXY 게이트로 별도 헬퍼화 가능 —
      // 현재는 단순화하여 null. CANDID-026 감사 로그에서 IP 추출 통일 예정.
      ipAddress: null,
    });

    const response = NextResponse.json({ user: result.user }, { status: 200 });
    setAuthCookies(response, {
      access: { token: result.tokens.accessToken, expiresAt: result.tokens.accessExpiresAt },
      refresh: {
        token: result.tokens.refreshToken,
        expiresAt: result.tokens.refreshExpiresAt,
      },
    });
    return response;
  }),
);
