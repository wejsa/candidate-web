import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// CANDID-041: scripts/check-migrations-no-concurrently.mjs (CANDID-038 회귀 가드) 무결성 검증.
// L-034 (회귀 가드 도입 PR에 가드 자체 단위 테스트 동반) 첫 적용.
// L-035 (정규식 멀티라인 false-negative 회피) 회귀 가드.
//
// 전략: 가드 스크립트를 자식 프로세스로 실행하여 실제 CLI 동작(exit code + stderr)을
// 검증한다. tmpdir에 prisma/migrations/ + 옵션 allowlist 파일을 구성하고 cwd를 지정한다.
// 가드 스크립트 자체는 본 task에서 변경하지 않는다 (CANDID-038에서 안정화됨).

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/check-migrations-no-concurrently.mjs');
const ALLOWLIST_REL = '.claude/state/migration-concurrently-allowlist.txt';

type Fixtures = {
  migrations: Record<string, string>; // dir 이름 → migration.sql 내용
  allowlist?: string[]; // allowlist 파일 라인들 (undefined면 파일 미생성)
  noMigrationsDir?: boolean; // edge: prisma/migrations 디렉토리 자체 부재
};

function setupTempProject(opts: Fixtures): string {
  const cwd = mkdtempSync(join(tmpdir(), 'candid-041-'));
  if (!opts.noMigrationsDir) {
    const migRoot = join(cwd, 'prisma/migrations');
    mkdirSync(migRoot, { recursive: true });
    for (const [dir, sql] of Object.entries(opts.migrations)) {
      const subDir = join(migRoot, dir);
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, 'migration.sql'), sql);
    }
  }
  if (opts.allowlist !== undefined) {
    mkdirSync(join(cwd, '.claude/state'), { recursive: true });
    writeFileSync(join(cwd, ALLOWLIST_REL), opts.allowlist.join('\n'));
  }
  return cwd;
}

function runGuard(cwd: string): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? -1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

const tmpDirs: string[] = [];
function track(cwd: string): string {
  tmpDirs.push(cwd);
  return cwd;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('check-migrations-no-concurrently — clean cases', () => {
  it('빈 migrations 디렉토리 → exit 0 + OK 메시지', () => {
    const cwd = track(setupTempProject({ migrations: {} }));
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  it('정상 마이그(CONCURRENTLY 없음) → exit 0', () => {
    const cwd = track(
      setupTempProject({
        migrations: {
          '00000000_normal':
            'CREATE INDEX "idx_a" ON "t" (a);\nCREATE UNIQUE INDEX "u_b" ON "t" (b);\n',
        },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
  });
});

describe('check-migrations-no-concurrently — allowlist', () => {
  it('allowlist 등록 파일 내 CONCURRENTLY → exit 0 (무시)', () => {
    const cwd = track(
      setupTempProject({
        migrations: {
          '00000000_legacy': 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_x" ON "t"(a);\n',
        },
        allowlist: ['prisma/migrations/00000000_legacy/migration.sql'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
  });

  it('allowlist 파일 부재 → 모두 비등록 취급, CONCURRENTLY 감지', () => {
    const cwd = track(
      setupTempProject({
        migrations: { '00000000_t': 'CREATE INDEX CONCURRENTLY "x" ON "t"(a);\n' },
        // allowlist 미정의 → 파일 자체 부재
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('00000000_t/migration.sql');
  });

  it('allowlist 주석/빈 라인 필터링 (T-MAJOR-4 in-PR fix)', () => {
    const cwd = track(
      setupTempProject({
        migrations: { '00000000_legacy': 'CREATE INDEX CONCURRENTLY "x" ON "t"(a);\n' },
        allowlist: [
          '# legacy 마이그 — 회수 예정',
          '',
          'prisma/migrations/00000000_legacy/migration.sql',
        ],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
  });
});

describe('check-migrations-no-concurrently — false-positive 차단 (코멘트)', () => {
  it('라인 주석 `-- CREATE INDEX CONCURRENTLY ...` → exit 0', () => {
    const cwd = track(
      setupTempProject({
        migrations: { '00000000_t': '-- CREATE INDEX CONCURRENTLY skip me\nSELECT 1;\n' },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
  });

  it('블록 주석 `/* CREATE INDEX CONCURRENTLY */` → exit 0 (L-035 stripSqlComments)', () => {
    const cwd = track(
      setupTempProject({
        migrations: { '00000000_t': '/* CREATE INDEX CONCURRENTLY skip me */\nSELECT 1;\n' },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
  });
});

describe('check-migrations-no-concurrently — DETECT 케이스 (L-035 회귀 가드)', () => {
  it('단일 라인 CREATE INDEX CONCURRENTLY → exit 1 + 라인 번호 보고', () => {
    const cwd = track(
      setupTempProject({
        migrations: {
          '00000000_t': 'SELECT 1;\nCREATE INDEX CONCURRENTLY "idx_x" ON "t"(a);\n',
        },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/migration\.sql:2/);
    expect(r.stderr).toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
  });

  it('멀티라인 DDL `CREATE INDEX\\n  CONCURRENTLY` → exit 1 + 라인 1 보고 (L-035 핵심)', () => {
    const cwd = track(
      setupTempProject({
        migrations: { '00000000_t': 'CREATE INDEX\n  CONCURRENTLY "idx_x" ON "t" (a);\n' },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    // T-MAJOR-3 in-PR fix: 라인 번호 단언 (stripSqlComments 라인 보존 메커니즘 검증)
    expect(r.stderr).toMatch(/migration\.sql:1/);
  });

  it('블록 주석 후 violation — 라인 번호 정확성 (stripSqlComments 라인 보존)', () => {
    const sql = '/* 3 줄\n블록\n주석 */\nCREATE INDEX CONCURRENTLY "x" ON "t"(a);\n';
    const cwd = track(setupTempProject({ migrations: { '00000000_t': sql } }));
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    // T-MAJOR-3 in-PR fix: 코멘트 4줄 + violation 4번째 라인 — stripSqlComments가 라인 보존하는지
    expect(r.stderr).toMatch(/migration\.sql:4/);
  });

  it('CREATE UNIQUE INDEX CONCURRENTLY → exit 1', () => {
    const cwd = track(
      setupTempProject({
        migrations: { '00000000_t': 'CREATE UNIQUE INDEX CONCURRENTLY "u_x" ON "t" (a);\n' },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY/i);
  });

  it('소문자 `create index concurrently` → exit 1 (T-MAJOR-1: /i flag 회귀 가드)', () => {
    const cwd = track(
      setupTempProject({
        migrations: { '00000000_t': 'create index concurrently "x" on "t"(a);\n' },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
  });

  it('선행 탭/공백 + CONCURRENTLY → exit 1', () => {
    const cwd = track(
      setupTempProject({
        migrations: { '00000000_t': '\tCREATE INDEX CONCURRENTLY "x" ON "t"(a);\n' },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('00000000_t/migration.sql');
  });

  it('여러 파일에 걸친 다중 위반 → 모두 보고 + exit 1', () => {
    const cwd = track(
      setupTempProject({
        migrations: {
          '00000000_a':
            'CREATE INDEX CONCURRENTLY "x" ON "t"(a);\nCREATE INDEX CONCURRENTLY "y" ON "t"(b);\n',
          '00000001_b': 'CREATE INDEX CONCURRENTLY "z" ON "t"(c);\n',
        },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/3건 감지/);
    expect(r.stderr).toContain('00000000_a/migration.sql');
    expect(r.stderr).toContain('00000001_b/migration.sql');
  });
});

describe('check-migrations-no-concurrently — edge case', () => {
  it('prisma/migrations 디렉토리 부재 → exit 2', () => {
    const cwd = track(setupTempProject({ migrations: {}, noMigrationsDir: true }));
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/디렉토리 없음/);
  });
});
