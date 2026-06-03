// CANDID-027 Step 3 — instrumentation register() 테스트.
// Node 런타임에서만 HTTP 메트릭 관측자를 배선하고 Edge에서는 no-op인지 검증한다.

import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRequestObserver, withErrorHandler } from '@/lib/errors';
import { __resetMetricsRegistryForTesting, renderMetrics } from '@/lib/observability/metrics';
import { register } from '@/instrumentation';

beforeEach(() => {
  __resetMetricsRegistryForTesting();
  setRequestObserver(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetMetricsRegistryForTesting();
  setRequestObserver(null);
});

async function fireRequest(): Promise<void> {
  const handler = withErrorHandler(async () => NextResponse.json({ ok: true }, { status: 200 }));
  await handler(new NextRequest('http://localhost/api/v1/jobs/9'), undefined);
}

describe('instrumentation.register', () => {
  it("NEXT_RUNTIME=nodejs 시 HTTP 메트릭 관측자를 배선한다", async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    await fireRequest();
    const text = await renderMetrics();
    expect(text).toContain('route="/api/v1/jobs/:id"');
  });

  it('NEXT_RUNTIME=edge 시 no-op (관측자 미배선)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    await fireRequest();
    const text = await renderMetrics();
    // 관측자가 없으므로 어떤 라벨 시계열도 기록되지 않는다.
    expect(text).not.toContain('route=');
  });
});
