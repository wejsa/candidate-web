import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// CANDID-043: scripts/check-guard-wiring-consistency.mjs (4자 일치 meta-guard) 무결성 검증.
// L-034 두 번째 적용 (첫 번째: CANDID-041) — meta-guard도 자체 vitest 동반 필수.
// L-037 self-application: 본 PR이 도입하는 "3종 세트 자동 검증" 원칙을 본 PR이 따름.
//
// binding 모델:
//   SKILL.md row "pnpm {npm}"
//     → package.json scripts[{npm}] = "node scripts/check-{base}.mjs"
//     → scripts/check-{base}.mjs + tests/scripts/check-{base}.test.ts 존재 필수

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/check-guard-wiring-consistency.mjs');

type Row = { glob: string; scriptCmd: string; id: string };
type Fixtures = {
  skillTable: Row[];
  scriptFiles?: string[]; // 가드 스크립트 base 이름 (예: 'migrations-no-concurrently')
  testFiles?: string[]; // 동일
  pkgScripts?: Record<string, string>; // package.json scripts 사용자 정의 (기본: skillTable의 npmScript → 표준 path)
  skillBodyOverride?: string;
};

function setupTempProject(opts: Fixtures): string {
  const cwd = mkdtempSync(join(tmpdir(), 'candid-043-'));

  // SKILL.md
  mkdirSync(join(cwd, '.claude/skills/skill-review-pr'), { recursive: true });
  let skill = opts.skillBodyOverride;
  if (!skill) {
    const rows = opts.skillTable
      .map((r) => `| \`${r.glob}\` | \`${r.scriptCmd}\` | ${r.id} | CANDID-XXX | dummy |`)
      .join('\n');
    skill = [
      '# skill-review-pr',
      '',
      '### 2.4. Pre-Review Guard Execution',
      '',
      '| 파일 글롭 | npm script | 가드 ID | 도입 | 근거 |',
      '|-----------|------------|---------|------|------|',
      rows,
      '',
      '### 2.5. 다음 섹션',
      '',
    ].join('\n');
  }
  writeFileSync(join(cwd, '.claude/skills/skill-review-pr/SKILL.md'), skill);

  // scripts/check-*.mjs
  mkdirSync(join(cwd, 'scripts'), { recursive: true });
  for (const base of opts.scriptFiles ?? []) {
    writeFileSync(join(cwd, `scripts/check-${base}.mjs`), '// dummy\n');
  }

  // tests/scripts/check-*.test.ts
  mkdirSync(join(cwd, 'tests/scripts'), { recursive: true });
  for (const base of opts.testFiles ?? []) {
    writeFileSync(join(cwd, `tests/scripts/check-${base}.test.ts`), '// dummy\n');
  }

  // package.json
  const scripts: Record<string, string> = { ...(opts.pkgScripts ?? {}) };
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', scripts }, null, 2),
  );

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

// 실제 프로젝트 매핑을 모방하는 row (SKILL.md npmScript와 파일 base가 다른 케이스 포함)
const ROW_MIG: Row = {
  glob: 'prisma/migrations/**/migration.sql',
  scriptCmd: 'pnpm check:migrations',
  id: 'G-MIG-CONCURRENTLY',
};

describe('check-guard-wiring-consistency — clean cases', () => {
  it('4자 모두 일치 (npm name ≠ 파일 base 케이스) → exit 0', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: { 'check:migrations': 'node scripts/check-migrations-no-concurrently.mjs' },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('1개 guard entry');
  });

  it('빈 매핑 표 → exit 0', () => {
    const cwd = track(setupTempProject({ skillTable: [] }));
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
  });
});

describe('check-guard-wiring-consistency — missing partners (SKILL.md row 있으나 partner 부재)', () => {
  it('package.json check:* 부재 → exit 1 + missing-package-script', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: {}, // ← 부재
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('missing-package-script');
    expect(r.stderr).toContain('G-MIG-CONCURRENTLY');
  });

  it('scripts/check-*.mjs 파일 부재 → exit 1 + missing-script', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: { 'check:migrations': 'node scripts/check-migrations-no-concurrently.mjs' },
        scriptFiles: [], // ← 부재
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('missing-script');
    expect(r.stderr).toContain('scripts/check-migrations-no-concurrently.mjs');
  });

  it('tests/scripts/check-*.test.ts 부재 → exit 1 + missing-test (L-034)', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: { 'check:migrations': 'node scripts/check-migrations-no-concurrently.mjs' },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: [], // ← 부재
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('missing-test');
    expect(r.stderr).toContain('L-034');
  });

  it('package.json scripts value 형식 위반 → exit 1 + invalid-package-script-command', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: { 'check:migrations': 'echo hi && rm -rf /' }, // ← 형식 위반
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('invalid-package-script-command');
  });
});

describe('check-guard-wiring-consistency — orphans (SKILL.md row 없으나 partner 존재)', () => {
  it('scripts/check-*.mjs orphan → exit 1 + orphan-script', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [],
        scriptFiles: ['other'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('orphan-script');
    expect(r.stderr).toContain('check-other.mjs');
  });

  it('package.json check:* orphan → exit 1 + orphan-package-script', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [],
        pkgScripts: { 'check:other': 'node scripts/check-other.mjs' },
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('orphan-package-script');
  });

  it('tests/scripts/check-*.test.ts orphan → exit 1 + orphan-test', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [],
        testFiles: ['other'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('orphan-test');
  });

  it('meta-guard self-allowlist (check-guard-wiring-consistency + check:guard-wiring) → orphan 분류 안 됨', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [],
        scriptFiles: ['guard-wiring-consistency'],
        testFiles: ['guard-wiring-consistency'],
        pkgScripts: { 'check:guard-wiring': 'node scripts/check-guard-wiring-consistency.mjs' },
      }),
    );
    const r = runGuard(cwd);
    // 3개 self 항목 모두 보고되지 않아야 함 → exit 0
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('orphan');
  });
});

describe('check-guard-wiring-consistency — environment errors', () => {
  it('SKILL.md §2.4 헤더 부재 → exit 2', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [],
        skillBodyOverride: '# skill-review-pr\n\n### 다른 섹션\n\n본문\n',
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('환경 오류');
    expect(r.stderr).toContain('헤더 미발견');
  });
});
