// CANDID-023 Step 3 — POST /api/v1/applications/me/{id}/withdraw (US-MY-003).
//
// 보안 컨트롤 (account-withdraw 정합):
//   1) middleware (전역) — HTTPS / CORS / CSRF Origin / 보안 헤더
//   2) withRateLimit(POLICIES.LOGIN) — IP 기준 10회/분
//   3) requireAuth — JWT 인증 + userId 추출. 미인증 → 401
//   4) enforceUserRateLimit(WITHDRAW_APPLICATION_USER) — 사용자당 10회/시간 (자원 소모형 abuse 차단)
//   5) 검증: applicationId(양의 정수) + body(WithdrawRequestSchema: reason trim+≤500, .strict())
//   6) withdrawApplication — 소유권은 서비스 조건부 UPDATE WHERE userId 가드. 미존재/비소유/종결 → 409
//
// body: reason 선택 — 빈 body 허용(사유 미입력 철회). 비어있지 않은 malformed JSON은 400으로 거부.
// 감사: userAgent 헤더(512자 클램프) 주입, ipAddress는 CANDID-026 통일 전까지 null.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { withdrawApplication } from '@/lib/applications/withdraw';
import { notifyApplicationWithdrawn } from '@/lib/notifications/slack';
import { WithdrawRequestSchema } from '@/lib/applications/schema';
import {
  POLICIES,
  USER_POLICIES,
  enforceUserRateLimit,
  withRateLimit,
} from '@/lib/security/rate-limit';
import { AppError, withErrorHandler } from '@/lib/errors';
import { withBusinessMetric } from '@/lib/observability/metrics';

interface RouteContext {
  params: { id: string };
}

const ApplicationIdSchema = z.coerce.number().int().positive();

export const POST = withErrorHandler(
  withRateLimit(
    POLICIES.LOGIN,
    withBusinessMetric(
      'application_withdraw',
      async (request: NextRequest, context: RouteContext) => {
        const { userId } = await requireAuth(request);

        const userRateLimit = enforceUserRateLimit(
          USER_POLICIES.WITHDRAW_APPLICATION_USER,
          userId,
          request,
        );
        if (userRateLimit.response !== null) return userRateLimit.response;

        let applicationId: number;
        try {
          applicationId = ApplicationIdSchema.parse(context.params.id);
        } catch (err) {
          if (err instanceof z.ZodError) {
            throw new AppError('SYS_VALIDATION_FAILED', {
              message: 'applicationId는 양의 정수여야 합니다.',
              details: err.issues.map((i) => ({ field: 'applicationId', reason: i.message })),
            });
          }
          throw err;
        }

        // 빈 body는 허용(사유 미입력 철회). 비어있지 않은 본문의 JSON 파싱 실패는 400으로 거부
        // — malformed payload를 조용히 무사유 철회로 흡수하지 않는다(비가역 전이 가시성).
        let raw: unknown = {};
        const bodyText = (await request.text()).trim();
        if (bodyText.length > 0) {
          try {
            raw = JSON.parse(bodyText);
          } catch {
            throw new AppError('SYS_VALIDATION_FAILED', {
              message: '요청 본문이 올바른 JSON이 아닙니다.',
            });
          }
        }

        let reason: string | undefined;
        try {
          reason = WithdrawRequestSchema.parse(raw).reason;
        } catch (err) {
          if (err instanceof z.ZodError) {
            throw new AppError('SYS_VALIDATION_FAILED', {
              message: '요청 본문이 올바르지 않습니다.',
              details: err.issues.map((i) => ({
                field: i.path.join('.') || 'body',
                reason: i.message,
              })),
            });
          }
          throw err;
        }

        const result = await withdrawApplication({
          userId,
          applicationId,
          reason: reason ?? null,
          // UA는 클라이언트 제어 문자열 — 감사 테이블 비대화 방지 위해 512자 클램프.
          userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
          // X-Forwarded-For 미신뢰 — CANDID-026 감사 IP 통일 전까지 null (account-withdraw 일관).
          ipAddress: null,
        });

        // BR-TX-02: 트랜잭션 커밋 후 어드민 Slack 알림 fire-and-forget. 실패해도 철회 응답 정상.
        // 사유 평문은 외부로 보내지 않음(BR-PII-02) — 존재 여부만 전달.
        void notifyApplicationWithdrawn({
          applicationId,
          hasReason: reason !== undefined && reason.trim() !== '',
        }).catch((err) => {
          console.warn(
            `[application-withdraw-slack-failed] applicationId=${applicationId} err=${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });

        const response = NextResponse.json(result, { status: 200 });
        userRateLimit.attachHeaders(response);
        return response;
      },
    ),
  ),
);
