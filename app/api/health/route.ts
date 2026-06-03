import { NextResponse, type NextRequest } from 'next/server';
import { withErrorHandler } from '@/lib/errors';

// CANDID-027 Step 2 — GET /api/health (liveness probe).
//
// 의존성 없는 생존 신호: 프로세스가 요청을 처리할 수 있으면 항상 200.
// DB/외부 의존성 검사는 readiness(/api/ready)의 책임 — liveness가 의존성에 묶이면
// 일시적 DB 장애로 컨테이너가 불필요하게 재시작(liveness 실패)되는 안티패턴이 된다.
// runtime='nodejs': process.uptime() 사용(Edge 미지원) + /api/metrics와 런타임 정합.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (_request: NextRequest) => {
  return NextResponse.json(
    {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
});
