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
  withBusinessMetric,
} from '@/lib/observability/metrics';

beforeEach(() => {
  __resetMetricsRegistryForTesting();
  // 파일 내 순서 의존 방지 — wireHttpMetrics가 설정한 전역 observer를 매 테스트 전 초기화.
  setRequestObserver(null);
});

afterEach(() => {
  __resetMetricsRegistryForTesting();
  setRequestObserver(null);
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

  it('LONG_OPAQUE 16자 경계: 15자는 보존, 16자는 :id로 치환', () => {
    expect(normalizeRoute('/t/deadbeefdeadbee')).toBe('/t/deadbeefdeadbee'); // 15자 — 미치환
    expect(normalizeRoute('/t/deadbeefdeadbeef')).toBe('/t/:id'); // 16자 — 치환
  });

  it('대문자/혼합 hex 16자+도 :id로 치환한다(대소문자 무관)', () => {
    expect(normalizeRoute('/t/ABCDEF0123456789')).toBe('/t/:id');
  });

  it('순수 숫자 세그먼트는 의도적으로 :id (연도/버전 포함 트레이드오프)', () => {
    // 정규화는 PK/식별자 카디널리티 억제가 목적 — 숫자만이면 연도(2024)도 :id로 뭉갠다(의도).
    expect(normalizeRoute('/posts/2024')).toBe('/posts/:id');
    // 반면 영숫자 버전 슬러그(v2)는 보존 — false collapse 아님.
    expect(normalizeRoute('/api/v2/jobs')).toBe('/api/v2/jobs');
  });

  it('빈 입력/루트/트레일링 슬래시 폴백', () => {
    expect(normalizeRoute('')).toBe('/');
    expect(normalizeRoute('/api/v1/jobs/')).toBe('/api/v1/jobs/'); // 트레일링 슬래시 보존
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

describe('withBusinessMetric', () => {
  it('2xx 응답 시 success 카운터를 증가시킨다', async () => {
    const wrapped = withBusinessMetric('signup', async (_req: NextRequest) =>
      NextResponse.json({ ok: true }, { status: 201 }),
    );
    const res = await wrapped(new NextRequest('http://localhost/api/v1/auth/signup'));
    expect(res.status).toBe(201);
    const text = await renderMetrics();
    expect(text).toContain('candidate_business_event_total{event="signup",result="success"} 1');
  });

  it('비-2xx 응답 시 failure 카운터를 증가시킨다', async () => {
    const wrapped = withBusinessMetric('file_upload', async (_req: NextRequest) =>
      NextResponse.json({ error: true }, { status: 409 }),
    );
    const res = await wrapped(new NextRequest('http://localhost/api/v1/files/resume/confirm'));
    expect(res.status).toBe(409);
    const text = await renderMetrics();
    expect(text).toContain(
      'candidate_business_event_total{event="file_upload",result="failure"} 1',
    );
  });

  it('handler가 throw하면 failure 기록 후 에러를 그대로 재던진다', async () => {
    const boom = new Error('submit failed');
    const wrapped = withBusinessMetric('application_submit', async (_req: NextRequest) => {
      throw boom;
    });
    await expect(
      wrapped(new NextRequest('http://localhost/api/v1/applications')),
    ).rejects.toBe(boom);
    const text = await renderMetrics();
    expect(text).toContain(
      'candidate_business_event_total{event="application_submit",result="failure"} 1',
    );
  });

  it('(request, context) 시그니처 핸들러의 context를 그대로 전달한다', async () => {
    let received: unknown;
    const wrapped = withBusinessMetric(
      'application_withdraw',
      async (_req: NextRequest, context: { params: { id: string } }) => {
        received = context;
        return NextResponse.json({ ok: true }, { status: 200 });
      },
    );
    const ctx = { params: { id: '42' } };
    await wrapped(new NextRequest('http://localhost/api/v1/applications/me/42/withdraw'), ctx);
    expect(received).toBe(ctx);
    const text = await renderMetrics();
    expect(text).toContain(
      'candidate_business_event_total{event="application_withdraw",result="success"} 1',
    );
  });
});
