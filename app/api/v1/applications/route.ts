// CANDID-018 Step 3 — POST /api/v1/applications (US-APP-006 지원서 최종 제출).
//
// 미들웨어 chain:
//   withErrorHandler → requireAuth → Idempotency-Key 검증 → body parse → idempotency lookup
//     → submitApplication → storeResponse → 201 응답
//
// 멱등성 invariant (BR-APP-06):
//   - 같은 (userId, Idempotency-Key) + 같은 body 재요청 → 첫 응답을 그대로 반환 (24시간)
//   - 같은 키 + 다른 body 재요청 → 400 SYS_VALIDATION_FAILED (mismatch)
//   - 다른 키 + 같은 body 재요청 → 새 제출 (UNIQUE 제약이 차후 단계에서 409 처리)
//
// 멱등성 캐싱 정책 (D-01 review fix loop 1 — 정책 명시):
//   - **성공(201)만 캐시**: storeResponse는 정상 path에서만 호출됨
//   - **비즈니스 실패(409/422/403/404 등)는 캐시 안 함**: withErrorHandler가 표준 에러로 변환할 뿐
//     storeResponse 호출은 일어나지 않음. 사유: ALREADY_SUBMITTED 후 다른 사용자의 지원이
//     철회/만료되어 상태가 바뀔 수 있음. 실패를 캐시하면 stale 응답을 24h 강제하게 됨.
//   - **SYS_INTERNAL_ERROR(500)도 캐시 안 함**: transient 오류를 24h 캐시하면 운영 사고.
//   - cache hit는 lookupAndVerify가 반환한 status를 그대로 반영 — 향후 정책 변경 여지를 위한 일반화
//     (현재 store는 201만 호출하므로 production에서 cache hit status는 항상 201).
//
// Rate Limit (review fix loop 1 carry — A-01):
//   현재 본 라우터는 withRateLimit/enforceUserRateLimit 미적용. signup/login 패턴과 불일치.
//   별도 follow-up task에서 USER_POLICIES.APP_SUBMIT_USER 신설 + enforceUserRateLimit 적용 예정.
//   임시 방어: Idempotency-Key 24h 보존 + BR-APP-01 활성 지원서 UNIQUE 제약이 부분 차단.
//
// 응답 본문은 PII-free: applicationNumber + submittedAt + currentStage (submitApplication 반환).

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { submitApplication } from '@/lib/applications/submit';
import { SubmitRequestSchema } from '@/lib/applications/schema';
import { IdempotencyKeySchema } from '@/lib/idempotency/schema';
import {
  hashRequestBody,
  IdempotencyRequestMismatchError,
  lookupAndVerify,
  storeResponse,
} from '@/lib/idempotency/store';
import { AppError, withErrorHandler } from '@/lib/errors';
import { withTraceContext } from '@/lib/observability/trace-context';

/** 응답 상태 — submit 성공은 201 Created. */
const SUBMIT_RESPONSE_STATUS = 201;

// withTraceContext: traceId 컨텍스트 seed → submitApplication 내부 APPLICATION_SUBMIT 감사에 전파(CANDID-026 Step 3).
export const POST = withErrorHandler(
  withTraceContext(async (request: NextRequest) => {
    // 1) 인증 (실패 시 AppError throw — withErrorHandler가 표준 응답 변환)
    const { userId } = await requireAuth(request);

    // 2) Idempotency-Key 헤더 검증 (BR-APP-06)
    const rawKey = request.headers.get('Idempotency-Key');
    if (rawKey === null || rawKey.length === 0) {
      throw new AppError('SYS_VALIDATION_FAILED', {
        message: 'Idempotency-Key 헤더가 필요합니다.',
        details: [{ field: 'Idempotency-Key', reason: 'header missing' }],
      });
    }
    let idempotencyKey: string;
    try {
      idempotencyKey = IdempotencyKeySchema.parse(rawKey);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new AppError('SYS_VALIDATION_FAILED', {
          message: 'Idempotency-Key 형식이 올바르지 않습니다.',
          details: err.issues.map((i) => ({
            field: 'Idempotency-Key',
            reason: i.message,
          })),
        });
      }
      throw err;
    }

    // 3) Body 파싱 — JSON parse 실패는 SYS_VALIDATION_FAILED로 통합 (ZodError와 동일 status 400)
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError('SYS_VALIDATION_FAILED', {
        message: '요청 본문이 유효한 JSON이 아닙니다.',
      });
    }

    // 4) 멱등성 lookup (parse 전 raw body 해시 — body 검증 실패도 멱등 응답 보존)
    // requestHash는 raw body 기준 — 같은 사용자가 같은 key + 같은 의미 body라면 zod 결과와 무관하게 일치.
    const requestHash = hashRequestBody(rawBody);
    let cached;
    try {
      cached = await lookupAndVerify(userId, idempotencyKey, requestHash);
    } catch (err) {
      if (err instanceof IdempotencyRequestMismatchError) {
        throw new AppError('SYS_VALIDATION_FAILED', {
          message: 'Idempotency-Key가 다른 요청 본문과 함께 재사용되었습니다.',
        });
      }
      throw err;
    }
    if (cached !== null) {
      // 캐시 hit — 첫 응답을 그대로 재현 (PII-free 응답이므로 평문 JSON 안전)
      return NextResponse.json(cached.responseJson, { status: cached.responseStatus });
    }

    // 5) Body 검증 (cache miss인 경우만 — cache hit는 첫 검증 결과를 그대로 반환)
    const body = SubmitRequestSchema.parse(rawBody);

    // 6) 제출 실행 (validate + 트랜잭션 + 이메일 fire-and-forget)
    const summary = await submitApplication({
      userId,
      jobPostingId: body.jobPostingId,
    });

    // 7) 멱등성 레코드 저장 (P2002 race는 create-only로 첫 응답 winner — storeResponse 내부 처리)
    await storeResponse({
      userId,
      key: idempotencyKey,
      requestHash,
      responseJson: summary,
      responseStatus: SUBMIT_RESPONSE_STATUS,
    });

    return NextResponse.json(summary, { status: SUBMIT_RESPONSE_STATUS });
  }),
);
