// CANDID-027 Step 1 — 메트릭 레지스트리 단위 테스트.
// globalThis 싱글톤 + reset helper(L-002) + 비즈니스 카운터/직렬화 동작을 검증한다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetMetricsRegistryForTesting,
  getMetricsRegistry,
  metricsContentType,
  recordBusinessEvent,
  renderMetrics,
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

    // reset 직후 카운터는 미관측 상태 → 해당 라벨 라인이 0 또는 부재.
    const after = await renderMetrics();
    expect(after).not.toContain(
      'candidate_business_event_total{event="application_withdraw",result="success"} 1',
    );
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
