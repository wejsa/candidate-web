import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { isAppError } from '@/lib/errors/app-error';
import type { ErrorDetail } from '@/lib/errors/app-error';
import { errorMessage, errorStatus } from '@/lib/errors/codes';
import type { ErrorCode } from '@/lib/errors/codes';
import { TRACE_HEADER, generateTraceId, normalizeTraceId } from '@/lib/observability/trace-header';

// CANDID-007 Step 2 — 표준 에러 응답 빌더 + 전역 핸들러 + Route Handler 래퍼.
// withErrorHandler로 감싼 Route Handler에서 throw된 예외를 handleApiError가
// 표준 응답 {timestamp,status,code,message,path,traceId,details}로 변환한다.
//   AppError  → 카탈로그 code/status/message
//   ZodError  → 400 SYS_VALIDATION_FAILED + issue별 details
//   그 외     → 500 SYS_INTERNAL_ERROR (원인·스택은 응답 비노출, 서버 로그에만 기록)
// 순수 TS + NextResponse + crypto.randomUUID만 사용 — Edge/Node 양 런타임 호환.

/** 표준 에러 응답 본문 — PRD §4.1.2 / CLAUDE.md 에러 응답 포맷. */
export interface ErrorResponseBody {
  timestamp: string;
  status: number;
  code: ErrorCode;
  message: string;
  path: string;
  traceId: string;
  details?: ErrorDetail[];
}

export interface ErrorResponseOptions {
  /** 카탈로그 기본 메시지 대신 사용할 메시지. 빈 값/공백이면 카탈로그 기본값으로 폴백. */
  message?: string;
  /** 필드 단위 상세. 빈 배열은 응답 본문에서 생략된다. */
  details?: ErrorDetail[];
  /** 요청 추적 ID. 미지정 시 새로 생성 — 전 구간 전파는 CANDID-026. */
  traceId?: string;
}

/** 운영 환경 여부 — 에러 핸들러는 throw하면 안 되므로 process.env를 직접 참조한다. */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * 표준 에러 응답을 생성한다. `code`는 카탈로그 ErrorCode이며 status/message가 자동 파생된다.
 */
export function errorResponse(
  request: NextRequest,
  code: ErrorCode,
  options: ErrorResponseOptions = {},
): NextResponse<ErrorResponseBody> {
  const status = errorStatus(code);
  const body: ErrorResponseBody = {
    timestamp: new Date().toISOString(),
    status,
    code,
    message: options.message?.trim() || errorMessage(code),
    path: request.nextUrl.pathname,
    traceId: options.traceId ?? crypto.randomUUID(),
  };
  if (options.details !== undefined && options.details.length > 0) {
    body.details = options.details;
  }
  return NextResponse.json(body, { status });
}

/** ZodError의 issue들을 표준 details 배열로 변환. */
function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    reason: issue.message,
  }));
}

/** 개발 환경 한정 — 디버깅용 예외 요약을 details에 담는다. 운영에서는 호출하지 않는다. */
function internalErrorDetails(error: unknown): ErrorDetail[] {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return [{ field: '(internal)', reason }];
}

/**
 * 임의의 throw 값을 표준 에러 응답으로 변환하는 전역 핸들러.
 * AppError/ZodError는 의도된 실패로 매핑하고, 그 외는 500 SYS_INTERNAL_ERROR로 수렴시킨다.
 * 예상치 못한 오류의 원인·스택은 서버 로그에만 남기고 응답 본문에는 노출하지 않는다.
 */
export function handleApiError(
  error: unknown,
  request: NextRequest,
  traceId: string = crypto.randomUUID(),
): NextResponse<ErrorResponseBody> {
  if (isAppError(error)) {
    return errorResponse(request, error.code, {
      message: error.message,
      details: error.details,
      traceId,
    });
  }
  if (error instanceof ZodError) {
    return errorResponse(request, 'SYS_VALIDATION_FAILED', {
      details: zodIssuesToDetails(error),
      traceId,
    });
  }
  console.error(`[${traceId}] Unhandled error — ${request.nextUrl.pathname}:`, error);
  return errorResponse(request, 'SYS_INTERNAL_ERROR', {
    details: isProduction() ? undefined : internalErrorDetails(error),
    traceId,
  });
}

/** Next.js App Router Route Handler 시그니처. */
type ApiRouteHandler<C> = (request: NextRequest, context: C) => Response | Promise<Response>;

/**
 * Route Handler를 감싸 throw된 예외를 표준 에러 응답으로 변환하는 HOF.
 * CANDID-026 Step 1: 미들웨어가 주입한 요청 헤더 x-trace-id를 읽어 에러 응답 traceId로 사용한다
 * (헤더 부재/부적합 시 신규 발급) → 미들웨어·에러 응답 간 traceId 통일.
 * 본 래퍼는 universal(Edge/Node/client 그래프 공용)이라 node:async_hooks에 의존하지 않는다.
 * 감사 emit이 인자 없이 traceId를 참조하도록 요청 범위 컨텍스트를 여는 것은 server 전용
 * withTraceContext(@/lib/observability/trace-context)의 책임으로 분리했다.
 * 사용: `export const POST = withErrorHandler(async (req) => { ... });`
 */
export function withErrorHandler<C = unknown>(handler: ApiRouteHandler<C>): ApiRouteHandler<C> {
  return async (request, context) => {
    const traceId = normalizeTraceId(request.headers.get(TRACE_HEADER)) ?? generateTraceId();
    try {
      return await handler(request, context);
    } catch (error) {
      return handleApiError(error, request, traceId);
    }
  };
}
