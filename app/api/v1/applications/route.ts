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

/** 응답 상태 — submit 성공은 201 Created. */
const SUBMIT_RESPONSE_STATUS = 201;

export const POST = withErrorHandler(async (request: NextRequest) => {
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
});
