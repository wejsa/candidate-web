import { NextResponse, type NextRequest } from 'next/server';
import { withErrorHandler } from '@/lib/errors';
import { basePrisma } from '@/lib/prisma';

// CANDID-027 Step 2 — GET /api/ready (readiness probe).
//
// 트래픽 수용 준비 여부: DB 연결이 살아있으면 200{db:up}, 아니면 503{db:down}.
// 오케스트레이터(k8s 등)는 503이면 해당 인스턴스로 트래픽을 보내지 않는다.
// DB probe 실패는 *정상적인 readiness 결과*이므로 throw가 아니라 503 응답으로 표현한다
// (withErrorHandler는 예기치 못한 오류만 500으로 수렴). runtime='nodejs': Prisma는 Node 전용.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DB 연결성 probe — PII/테이블 접근 없는 상수 SELECT. basePrisma(raw 클라이언트) 사용. */
async function isDatabaseReachable(): Promise<boolean> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- readiness probe: 상수 `SELECT 1`, 테이블/PII 미접근. piiExtension 불필요.
    await basePrisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    // DSN 누출 방지를 위해 error 객체 전체가 아닌 종류만 로깅.
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[ready] database probe failed: ${name}`);
    return false;
  }
}

export const GET = withErrorHandler(async (_request: NextRequest) => {
  const dbUp = await isDatabaseReachable();
  if (!dbUp) {
    return NextResponse.json(
      { status: 'unready', checks: { db: 'down' }, timestamp: new Date().toISOString() },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    { status: 'ready', checks: { db: 'up' }, timestamp: new Date().toISOString() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
});
