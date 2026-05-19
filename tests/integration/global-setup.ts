import { spawnSync } from 'node:child_process';

// CANDID-035 Step 1 — 통합 테스트 globalSetup. suite 전체에서 1회 실행.
//
// `prisma migrate deploy`로 `test_integration` schema에 모든 마이그레이션을 멱등 apply.
// 이미 apply된 마이그레이션은 skip되므로 반복 실행 비용은 낮다.
//
// 주의: globalSetup은 별도 node process에서 동작하므로 setup.ts의 process.env 변경이
// 전달되지 않는다. 본 파일에서 DATABASE_URL을 다시 계산해 spawn env에 명시 주입한다.

const DEFAULT_BASE_URL = 'postgresql://candidate:candidate@localhost:5432/candidate_web';
const TEST_SCHEMA = 'test_integration';

function resolveTestDatabaseUrl(): string {
  const baseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_BASE_URL;
  const url = new URL(baseUrl);
  url.searchParams.set('schema', TEST_SCHEMA);
  return url.toString();
}

// H005 (CANDID-035 Step 1 review) — URL 객체로 password를 명확히 마스킹.
// 기존 정규식(`:[^:@]+@`)은 비밀번호에 `:`가 포함될 때 첫 `:`부터만 매칭되는 한계.
function maskDatabaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return raw.replace(/:[^:@/]+@/, ':***@');
  }
}

export async function setup(): Promise<void> {
  const databaseUrl = resolveTestDatabaseUrl();
  // eslint-disable-next-line no-console
  console.log(`[integration] migrate deploy → ${maskDatabaseUrl(databaseUrl)}`);

  const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  // H007 (CANDID-035 Step 1 review) — spawn 자체 실패(`pnpm` 미설치 등) 별도 분기.
  if (result.error) {
    throw new Error(
      `[integration] failed to spawn 'pnpm exec prisma migrate deploy': ${result.error.message}. ` +
        `pnpm/Node가 설치되어 있는지 확인하세요.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `[integration] prisma migrate deploy failed (status=${result.status}). ` +
        `docker-compose db 가 기동되어 있고 (\`pnpm db:up\`) ${maskDatabaseUrl(databaseUrl)}에 연결 가능한지 확인하세요.`,
    );
  }
}
