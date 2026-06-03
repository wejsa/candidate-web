// CANDID-027 Step 1 — 메트릭 레지스트리 단위 테스트.
// globalThis 싱글톤 + reset helper(L-002) + 비즈니스 카운터/직렬화 동작을 검증한다.

import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setRequestObserver, withErrorHandler } from '@/lib/errors';
import {
  __resetMetricsRegistryForTesting,
  getMetricsRegistry,
  metricsContentType,
  normalizeRoute,
  recordBusinessEvent,
  recordHttpRequest,
  renderMetrics,
  wireHttpMetrics,
} from '@/lib/observability/metrics';

beforeEach(() => {
  __resetMetricsRegistryForTesting();
});

afterEach(() => {
  __resetMetricsRegistryForTesting();
});

describe('metrics registry', () => {
  it('동일 레지스트리 인스턴스를 반환한다 (싱글톤)', () => {
    expect(getMetricsRegistry()).toBe(getMetricsRegistry());
  });

  it('Node 프로세스 기본 지표를 포함한다', async () => {
    const text = await renderMetrics();
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('nodejs_eventloop_lag_seconds');
  });

  it('Prometheus exposition content-type을 노출한다', () => {
    expect(metricsContentType()).toContain('text/plain');
    expect(metricsContentType()).toContain('version=0.0.4');
  });

  it('http_request_duration 히스토그램이 레지스트리에 등록된다', async () => {
    // 관측(Step 3 wiring) 전이라 prom-client는 버킷 시계열을 아직 렌더하지 않으므로
    // 인스턴스 등록 사실(TYPE 헤더)만 회귀 가드한다. 버킷 경계(0.3/0.8) 검증은 Step 3.
    const text = await renderMetrics();
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
  });
});

describe('recordBusinessEvent', () => {
  it('이벤트/결과 라벨별로 카운터를 증가시킨다', async () => {
    recordBusinessEvent('signup', 'success');
    recordBusinessEvent('signup', 'success');
    recordBusinessEvent('application_submit', 'failure');

    const text = await renderMetrics();
    expect(text).toContain(
      'candidate_business_event_total{event="signup",result="success"} 2',
    );
    expect(text).toContain(
      'candidate_business_event_total{event="application_submit",result="failure"} 1',
    );
  });

  it('result 기본값은 success다', async () => {
    recordBusinessEvent('file_upload');
    const text = await renderMetrics();
    expect(text).toContain(
      'candidate_business_event_total{event="file_upload",result="success"} 1',
    );
  });
});

describe('__resetMetricsRegistryForTesting', () => {
  it('reset 후 누적값이 초기화된다', async () => {
    recordBusinessEvent('application_withdraw', 'success');
    expect(await renderMetrics()).toContain(
      'candidate_business_event_total{event="application_withdraw",result="success"} 1',
    );

    __resetMetricsRegistryForTesting();

    // reset 직후 해당 라벨 시계열 자체가 부재해야 한다(값 1이 아님이 아니라 라인 전체 부재 — 위양성 방지).
    const after = await renderMetrics();
    expect(after).not.toContain('event="application_withdraw"');
  });

  it('reset 후에도 재등록 예외 없이 새 레지스트리를 생성한다', async () => {
    const first = getMetricsRegistry();
    __resetMetricsRegistryForTesting();
    const second = getMetricsRegistry();
    expect(second).not.toBe(first);
    // 새 레지스트리에서 정상 동작(중복 등록 throw 없음).
    expect(() => recordBusinessEvent('signup')).not.toThrow();
    expect(await renderMetrics()).toContain('candidate_business_event_total');
  });
});

describe('normalizeRoute', () => {
  it.each([
    ['/', '/'],
    ['/api/v1/jobs', '/api/v1/jobs'],
    ['/api/v1/jobs/123', '/api/v1/jobs/:id'],
    [
      '/api/v1/applications/me/123e4567-e89b-12d3-a456-426614174000/withdraw',
      '/api/v1/applications/me/:id/withdraw',
    ],
    ['/api/v1/applications/A-202606-00001', '/api/v1/applications/:id'],
    ['/api/v1/tokens/deadbeefdeadbeef0123', '/api/v1/tokens/:id'],
  ])('%s → %s (동적 세그먼트 정규화)', (input, expected) => {
    expect(normalizeRoute(input)).toBe(expected);
  });

  it('알파벳 세그먼트(me, withdraw 등)는 보존한다', () => {
    expect(normalizeRoute('/api/v1/users/me/withdraw')).toBe('/api/v1/users/me/withdraw');
  });
});

describe('recordHttpRequest', () => {
  it('정규화 route/대문자 method/상태군 라벨로 히스토그램을 기록한다', async () => {
    recordHttpRequest('get', '/api/v1/jobs/42', 200, 0.123);
    const text = await renderMetrics();
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/v1/jobs/:id",status_class="2xx"} 1',
    );
  });

  it.each([
    [204, '2xx'],
    [301, '3xx'],
    [422, '4xx'],
    [503, '5xx'],
  ])('status %d → status_class %s', async (status, klass) => {
    recordHttpRequest('POST', '/api/v1/applications', status, 0.5);
    const text = await renderMetrics();
    expect(text).toContain(`status_class="${klass}"`);
  });
});

describe('wireHttpMetrics', () => {
  afterEach(() => {
    setRequestObserver(null);
  });

  it('withErrorHandler 요청을 정규화 라벨로 히스토그램에 관측한다', async () => {
    wireHttpMetrics();
    const handler = withErrorHandler(async () => NextResponse.json({ ok: true }, { status: 200 }));
    await handler(new NextRequest('http://localhost/api/v1/jobs/7'), undefined);
    const text = await renderMetrics();
    expect(text).toContain('route="/api/v1/jobs/:id"');
    expect(text).toContain('method="GET"');
    expect(text).toContain('status_class="2xx"');
  });
});
