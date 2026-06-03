import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextRequest } from 'next/server';
import {
  TRACE_HEADER,
  generateTraceId,
  normalizeTraceId,
} from '@/lib/observability/trace-header';

// CANDID-026 Step 1 — 요청 범위 traceId 컨텍스트 (Node 런타임 전용).
// node:async_hooks를 import하므로 Edge(middleware)에서 import 금지 — Edge-safe 유틸은 trace-header.ts.
// withErrorHandler가 요청 진입 시 runWithTrace로 컨텍스트를 seed하고, 깊은 호출부(감사 emit 등)는
// getTraceId()로 인자 전달 없이 동일 traceId를 참조한다(분산 추적 전파). 컨텍스트는 await 경계를
// 넘어 유지되므로 비동기 핸들러 전체가 동일 store를 공유한다.

interface TraceStore {
  traceId: string;
}

const storage = new AsyncLocalStorage<TraceStore>();

/** 주어진 traceId(부적합/부재 시 신규 발급)로 컨텍스트를 열고 fn을 실행한다. */
export function runWithTrace<T>(traceId: string | null | undefined, fn: () => T): T {
  const resolved = normalizeTraceId(traceId) ?? generateTraceId();
  return storage.run({ traceId: resolved }, fn);
}

/** 현재 컨텍스트의 traceId. 컨텍스트 밖이면 undefined. */
export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/** 현재 컨텍스트 traceId, 컨텍스트 밖이면 신규 발급. 응답 빌더/에러 핸들러 기본값용. */
export function getTraceIdOrNew(): string {
  return storage.getStore()?.traceId ?? generateTraceId();
}

/** Next.js App Router Route Handler 시그니처. */
type ApiRouteHandler<C> = (request: NextRequest, context: C) => Response | Promise<Response>;

/**
 * Route Handler를 감싸 미들웨어 주입 x-trace-id로 요청 범위 traceId 컨텍스트를 연다(Node 전용).
 * 핸들러 본문에서 호출되는 감사 emit(CANDID-026 Step 2~)이 인자 전달 없이 getTraceId()로 동일
 * traceId를 참조하게 한다. 감사 이벤트를 발행하는 라우트에만 선택적으로 적용한다 — universal
 * withErrorHandler(@/lib/errors)와 합성: `withErrorHandler(withTraceContext(handler))`.
 */
export function withTraceContext<C = unknown>(handler: ApiRouteHandler<C>): ApiRouteHandler<C> {
  return (request, context) =>
    runWithTrace(request.headers.get(TRACE_HEADER), () => handler(request, context));
}
