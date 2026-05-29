import { NextResponse, type NextRequest } from 'next/server';
import { resetPassword } from '@/lib/auth/password-reset';
import { PasswordResetInputSchema } from '@/lib/auth/validation';
import { withErrorHandler } from '@/lib/errors';
import { POLICIES, withRateLimit } from '@/lib/security/rate-limit';

// CANDID-020 Step 4 — POST /api/v1/auth/password/reset (US-AUTH-004, BR-AUTH-05).
//
// 비인증 엔드포인트. 재설정 토큰 + 새 비밀번호로 비밀번호를 변경한다.
// 보안 컨트롤:
//   withRateLimit(POLICIES.PASSWORD_RESET) — 5회/시간/IP (토큰 brute force 무의미하나 DoS 차단)
//   withErrorHandler — ZodError(약한 비번/불일치/토큰 형식) → 400, AppError(토큰 무효/만료) → 400/410
//
// 단일 트랜잭션(서비스): 토큰 race-safe consume + passwordHash 갱신 + 모든 refresh 세션 무효화.
// 성공 시 기존 세션이 전부 무효화되므로 사용자는 새 비밀번호로 재로그인해야 한다.

const SUCCESS_MESSAGE = '비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.';

export const POST = withErrorHandler(
  withRateLimit(POLICIES.PASSWORD_RESET, async (request: NextRequest) => {
    const { token, password } = PasswordResetInputSchema.parse(await request.json());

    // 토큰 무효/만료는 AppError(AUTH_RESET_TOKEN_*) → withErrorHandler가 400/410으로 변환.
    await resetPassword(token, password);

    return NextResponse.json({ message: SUCCESS_MESSAGE }, { status: 200 });
  }),
);
