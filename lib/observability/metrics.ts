import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

// CANDID-027 Step 1 — Prometheus 메트릭 레지스트리 (관측 SSOT).
//
// 설계 요지:
//   - Registry/지표 인스턴스를 globalThis에 캐싱(lib/prisma.ts와 유사한 싱글톤 보존) — Next.js dev
//     핫리로드 / vitest 다중 파일 로드 시 prom-client의 중복 등록 예외를 방지한다.
//     (단, 캐싱 조건은 prisma와 다름 — getMetricsBundle 주석 참조.)
//   - 커스텀 지표 정의의 단일 진실원. 비즈니스 카운터(Step 4)와 HTTP 히스토그램(Step 3)의
//     "인스턴스"는 여기서 생성하고, "기록 호출부"만 각 스텝에서 wiring한다.
//   - prom-client는 Node 전용(process 지표 수집). 소비 엔드포인트는 runtime='nodejs' 강제.
//
// L-002: 모듈 스코프(globalThis) 상태이므로 도입 시점에 __resetMetricsRegistryForTesting을
//        함께 export하여 테스트 격리(vitest isolate:true와 정합)를 보장한다.

/** 비즈니스 이벤트 종류 — 가입/제출/철회/파일 업로드 (NFR: 주요 도메인 이벤트 가시화). */
export type BusinessEvent =
  | 'signup'
  | 'application_submit'
  | 'application_withdraw'
  | 'file_upload';

/** 이벤트 처리 결과 라벨 — 성공/실패 분리 집계. */
export type EventResult = 'success' | 'failure';

/** HTTP 응답 상태 군(2xx/3xx/4xx/5xx) — 상태코드 원본 대신 군으로 라벨하여 카디널리티 억제. */
export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

interface MetricsBundle {
  registry: Registry;
  /** candidate_business_event_total{event,result} — 4 이벤트 × 2 결과 = 8 시계열로 한정. */
  businessEvents: Counter<'event' | 'result'>;
  /** http_request_duration_seconds{method,route,status_class} — P95(목록<300ms/제출<800ms) 가시화. */
  httpRequestDuration: Histogram<'method' | 'route' | 'status_class'>;
}

declare global {
  // eslint-disable-next-line no-var
  var __metrics: MetricsBundle | undefined;
}

function createMetricsBundle(): MetricsBundle {
  const registry = new Registry();
  // Node 프로세스 기본 지표(heap/eventloop/gc 등) — 별도 prefix 없이 표준 이름 사용.
  collectDefaultMetrics({ register: registry });

  const businessEvents = new Counter({
    name: 'candidate_business_event_total',
    help: '주요 비즈니스 이벤트 누적 횟수 (가입/지원서 제출/철회/파일 업로드)',
    labelNames: ['event', 'result'] as const,
    registers: [registry],
  });

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP 요청 처리 시간(초). route는 동적 세그먼트가 정규화된 경로.',
    labelNames: ['method', 'route', 'status_class'] as const,
    // NFR 경계(0.3s 목록 / 0.8s 제출)를 버킷에 포함해 P95 판독을 용이하게 한다.
    buckets: [0.05, 0.1, 0.3, 0.5, 0.8, 1, 2, 5],
    registers: [registry],
  });

  return { registry, businessEvents, httpRequestDuration };
}

// lazy 싱글톤 접근자 — 최초 호출 시 1회 생성 후 globalThis에 보존.
// 주의: lib/prisma.ts는 NODE_ENV!=='production'에서만 globalThis에 캐싱(dev 핫리로드 한정)하지만,
//   메트릭 카운터는 운영에서도 요청 간 누적이 보존돼야 하므로 환경 무관하게 무조건 캐싱한다.
function getMetricsBundle(): MetricsBundle {
  if (!globalThis.__metrics) {
    globalThis.__metrics = createMetricsBundle();
  }
  return globalThis.__metrics;
}

/** Prometheus 노출 엔드포인트(/api/metrics)가 사용하는 레지스트리. */
export function getMetricsRegistry(): Registry {
  return getMetricsBundle().registry;
}

/**
 * 비즈니스 이벤트 1건을 기록한다. 라우트 핸들러(Step 4)에서 성공/실패 경로별로 호출한다.
 * 도메인 의미가 명확한 4개 이벤트로 한정 — 임의 문자열 라벨 유입(카디널리티 폭발)을 타입으로 차단.
 */
export function recordBusinessEvent(event: BusinessEvent, result: EventResult = 'success'): void {
  getMetricsBundle().businessEvents.inc({ event, result });
}

/** 직렬화된 Prometheus 텍스트(exposition format)를 반환한다. */
export function renderMetrics(): Promise<string> {
  return getMetricsRegistry().metrics();
}

/** Prometheus exposition content-type (예: text/plain; version=0.0.4; charset=utf-8). */
export function metricsContentType(): string {
  return getMetricsRegistry().contentType;
}

/**
 * 테스트 전용 — globalThis에 캐싱된 레지스트리/지표를 초기화한다.
 * prom-client는 동일 이름 지표를 같은 레지스트리에 중복 등록하면 throw하므로,
 * 각 테스트가 깨끗한 상태에서 시작하도록 clear 후 캐시를 비운다 (L-002).
 */
export function __resetMetricsRegistryForTesting(): void {
  globalThis.__metrics?.registry.clear();
  globalThis.__metrics = undefined;
}
