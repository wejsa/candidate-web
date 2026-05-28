import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { clearAuthCookies } from '@/lib/auth/cookies';
import { withErrorHandler } from '@/lib/errors';
import {
  POLICIES,
  USER_POLICIES,
  enforceUserRateLimit,
  withRateLimit,
} from '@/lib/security/rate-limit';
import { WithdrawInputSchema } from '@/lib/users/schema';
import { withdrawUser } from '@/lib/users/withdraw';

// CANDID-022 Step 3 — POST /api/v1/users/me/withdraw (US-AUTH-005, BR-PII-03/04, BR-AUTH-05).
//
// 보안 컨트롤 (deep defense):
//   1) middleware (전역) — HTTPS / CORS / CSRF Origin / 보안 헤더 자동 적용
//   2) withRateLimit(POLICIES.LOGIN) — IP 기준 10회/분 (비밀번호 brute force 차단)
//   3) requireAuth — JWT 인증 통과 + AuthContext { userId } 추출. 미인증 → 401 AUTH_TOKEN_*
//   4) enforceUserRateLimit(USER_POLICIES.WITHDRAW_USER) — 사용자당 3회/시간 (IP 회전 공격 차단)
//   5) WithdrawInputSchema.parse — `.strict()`로 여분 키 거부, passwordConfirmation 1~256자, reason ≤500자 trim
//   6) withdrawUser — 본인 인증 (passwordHash 보유 시 비밀번호 재확인) + 분기 처리 + audit + revoke
//   7) clearAuthCookies — 응답 시 Set-Cookie maxAge=0으로 access_token / refresh_token 즉시 만료
//
// 응답 정책:
//   - 204 No Content: 성공 (분기/카운트 등 PII-adjacent 정보는 body 비공개 — BR-PII-02)
//   - 401: AUTH_INVALID_CREDENTIALS (비밀번호 불일치), AUTH_TOKEN_INVALID/EXPIRED (인증 토큰)
//   - 409: USER_ALREADY_WITHDRAWN (멱등 — 본인 두 번째 호출, race 등)
//   - 422: USER_PASSWORD_RECONFIRM_REQUIRED (passwordHash 보유 + 비밀번호 누락)
//          USER_REAUTH_REQUIRED (passwordHash NULL — 소셜 전용, MVP 차단 / CANDID-022 FU1)
//          SYS_VALIDATION_FAILED (zod)
//   - 429: SYS_RATE_LIMITED (IP 또는 user-bucket 한도)
//
// 자기 식별 단서 노출 위험 (Step 1 review M005 / Step 2 carry H004):
//   USER_REAUTH_REQUIRED 메시지는 본인 인증 통과 후에만 노출되므로 외부 oracle 노출 없음.
//   클라이언트 분기를 위해 메시지 차이는 유지 — 정책 결정은 PRD §8 미결사항(소셜 탈퇴 정책)에 합류.

export const POST = withErrorHandler(
  withRateLimit(POLICIES.LOGIN, async (request: NextRequest) => {
    const ctx = await requireAuth(request);

    const userRateLimit = enforceUserRateLimit(
      USER_POLICIES.WITHDRAW_USER,
      ctx.userId,
      request,
    );
    if (userRateLimit.response !== null) return userRateLimit.response;

    const body = WithdrawInputSchema.parse(await request.json());

    await withdrawUser({
      userId: ctx.userId,
      passwordConfirmation: body.passwordConfirmation,
      reason: body.reason,
      userAgent: request.headers.get('user-agent'),
      // X-Forwarded-For 신뢰는 lib/security/rate-limit.ts와 동일 정책 — login route와 일관 null 유지.
      // CANDID-026 감사 로그에서 IP 추출 통일 예정.
      ipAddress: null,
    });

    // 204 No Content + Set-Cookie maxAge=0 (access_token / refresh_token 즉시 만료).
    // anonymize 경로에선 user.passwordHash NULL + status=WITHDRAWN으로 동시 로그인 차단 +
    // hard_deleted 경로에선 refresh_tokens CASCADE — 클라이언트 Cookie 정리 최종 단계.
    const response = new NextResponse(null, { status: 204 });
    clearAuthCookies(response);
    userRateLimit.attachHeaders(response);
    return response;
  }),
);
