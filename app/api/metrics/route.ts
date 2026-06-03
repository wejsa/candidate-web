import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { AppError, withErrorHandler } from '@/lib/errors';
import { metricsContentType, renderMetrics } from '@/lib/observability/metrics';

// CANDID-027 Step 1 — GET /api/metrics (Prometheus scrape 엔드포인트).
//
// 보안:
//   METRICS_AUTH_TOKEN이 설정되면 `Authorization: Bearer <token>` 일치를 요구한다(불일치 → 403).
//   미설정 시: 운영(production)은 노출 결함으로 간주해 fail-closed(403), 개발/테스트는 내부망
//   스크랩 편의를 위해 허용(open). 토폴로지 실수로 /metrics가 외부 인그레스에 노출돼도 운영에서는
//   무인증 노출이 차단된다(S-MAJOR PR #117 리뷰 반영).
//   이 토큰은 *필수 비밀*이 아니라 선택적 운영 토글이므로 lib/env.ts(부팅 zod fail-fast)가 아닌
//   요청 시점 process.env 직접 read로 평가한다 — 단위 테스트로 환경별 분기 검증 가능.
//
// 런타임: prom-client는 Node 전용(process 지표)이라 Edge 금지 → runtime='nodejs' 강제.
//   캐시 무력화(force-dynamic + no-store): 스크랩마다 현재 값 반환.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 길이 누출 없는 상수 시간 문자열 비교 — 스크랩 토큰 타이밍 공격 방지. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** METRICS_AUTH_TOKEN 설정 시에만 Bearer 토큰 일치를 강제한다. */
function assertMetricsAuthorized(request: NextRequest): void {
  const expected = process.env.METRICS_AUTH_TOKEN?.trim();
  if (!expected) {
    // 운영은 fail-closed(무인증 노출 차단), 비운영은 open(내부망 스크랩 편의).
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('AUTH_FORBIDDEN', { message: '메트릭 엔드포인트 접근 권한이 없습니다.' });
    }
    return;
  }
  const header = request.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token || !safeEqual(token, expected)) {
    throw new AppError('AUTH_FORBIDDEN', { message: '메트릭 엔드포인트 접근 권한이 없습니다.' });
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  assertMetricsAuthorized(request);
  const body = await renderMetrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': metricsContentType(),
      'Cache-Control': 'no-store',
    },
  });
});
