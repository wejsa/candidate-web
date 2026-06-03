// CANDID-026 Step 1 — Edge-safe traceId 헤더 유틸 (분산 추적 전파).
// middleware(Edge runtime)와 Node 핸들러 양쪽에서 import하므로 node: 모듈 의존을 금지한다.
// AsyncLocalStorage 기반 요청 컨텍스트는 trace-context.ts(Node 전용)에 분리했다.

/** 요청/응답 전 구간에서 traceId를 운반하는 헤더 이름. */
export const TRACE_HEADER = 'x-trace-id';

// W3C traceparent: `version-traceid-spanid-flags` (traceid = 32 hex).
const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
// trace_id 컬럼은 VARCHAR(36) — UUID(36) 또는 W3C trace-id(32) 모두 수용. 제어문자/공백 차단.
const VALID_TRACE_ID = /^[0-9A-Za-z-]{1,36}$/;

/** W3C traceparent 헤더에서 32-hex trace-id를 추출한다. 형식 불일치/all-zero면 null. */
export function parseTraceparent(value: string | null): string | null {
  if (value === null) return null;
  const matched = TRACEPARENT.exec(value.trim().toLowerCase());
  const traceId = matched?.[1];
  if (traceId === undefined) return null;
  // all-zero trace-id는 W3C 명세상 invalid.
  return /^0+$/.test(traceId) ? null : traceId;
}

/** audit_logs.trace_id(VARCHAR(36)) 제약에 맞춰 정규화한다. 부적합하면 null. */
export function normalizeTraceId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 36) return null;
  return VALID_TRACE_ID.test(trimmed) ? trimmed : null;
}

/** 새 traceId를 발급한다. crypto.randomUUID는 Edge/Node 양 런타임이 제공. */
export function generateTraceId(): string {
  return crypto.randomUUID();
}

/**
 * 수신 헤더에서 traceId를 해석한다. 우선순위:
 *   1) x-trace-id  — 자체 전파 헤더(내부 게이트웨이 → 미들웨어 → 핸들러)
 *   2) traceparent — W3C 표준(외부 클라이언트/APM 추적 연계)
 *   3) 부재/부적합 → null (호출측이 generateTraceId로 신규 발급)
 */
export function resolveIncomingTraceId(getHeader: (name: string) => string | null): string | null {
  return normalizeTraceId(getHeader(TRACE_HEADER)) ?? parseTraceparent(getHeader('traceparent'));
}
