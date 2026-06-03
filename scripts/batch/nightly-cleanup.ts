// CANDID-029 Step 1 — 야간 정리 배치 CLI 엔트리포인트.
//
// 실행: `pnpm batch:nightly` — 외부 스케줄러(cron / k8s CronJob / GitHub Actions)가 호출한다.
//   스택에 메시지 큐·스케줄러가 없으므로(messageQueue: none) 배치는 외부에서 트리거되는 CLI다.
//
// 'server-only' / lib/prisma import 금지: 본 파일과 lib/batch/*는 Node CLI(tsx) 컨텍스트로 실행되며
//   'server-only'(Next.js RSC 가드)는 CLI에서 throw한다. prisma/seed.ts 선례대로 PrismaClient를
//   직접 생성·주입하고 종료 시 $disconnect한다.
import { PrismaClient } from '@prisma/client';
import { runNightlyCleanup } from '@/lib/batch/runner';
import { withBatchTimeouts } from '@/lib/batch/db';

async function main(): Promise<void> {
  // 배치 전용 클라이언트. cron 환경에서 DB 응답 지연 시 배치가 무한 대기하면 다음 스케줄과
  // 겹쳐 커넥션이 누적될 수 있다. DATABASE_URL에 연결/문장 타임아웃 파라미터가 없으면 보수적으로
  // 부여한다(이미 지정돼 있으면 사용자 값을 존중 — 덮어쓰지 않음).
  const db = new PrismaClient({ datasourceUrl: withBatchTimeouts(process.env.DATABASE_URL) });
  try {
    const result = await runNightlyCleanup(db);
    for (const task of result.tasks) {
      const status = task.error === null ? 'OK  ' : 'FAIL';
      console.warn(
        `[batch] ${status} ${task.name} deleted=${task.deleted} ${task.durationMs}ms` +
          (task.error !== null ? ` error=${task.error}` : ''),
      );
    }
    console.warn(
      `[batch] done totalDeleted=${result.totalDeleted} ${result.durationMs}ms hasError=${result.hasError}`,
    );
    process.exitCode = result.hasError ? 1 : 0;
  } finally {
    await db.$disconnect();
  }
}

void main().catch((err: unknown) => {
  // PII-free: name만 기록(메시지에 자격증명/연결 문자열이 합성될 수 있음).
  console.error('[batch] fatal', err instanceof Error ? err.name : 'Unknown');
  process.exitCode = 1;
});
