// CANDID-027 Step 3 — Next.js 서버 부팅 훅 (https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
// Node 런타임에서만 HTTP 메트릭 관측자(metrics.recordHttpRequest)를 withErrorHandler에 배선한다.
// prom-client는 Node 전용이므로 동적 import + NEXT_RUNTIME 가드로 Edge 번들 유입을 차단한다.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { wireHttpMetrics } = await import('@/lib/observability/metrics');
    wireHttpMetrics();
  }
}
