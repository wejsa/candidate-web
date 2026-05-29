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

// CANDID-045 D-5: meta-guard는 scripts/meta/로 이동.
const SCRIPT_PATH = resolve(process.cwd(), 'scripts/meta/check-guard-wiring-consistency.mjs');

type Row = { glob: string; scriptCmd: string; id: string };
type Fixtures = {
  skillTable: Row[];
  scriptFiles?: string[]; // USER-LEVEL 가드 base 이름 (scripts/check-{base}.mjs)
  metaScriptFiles?: string[]; // CANDID-045 D-5: META-LEVEL 가드 base (scripts/meta/check-{base}.mjs)
  testFiles?: string[]; // tests/scripts/check-{base}.test.ts
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

  // scripts/check-*.mjs (USER-LEVEL)
  mkdirSync(join(cwd, 'scripts'), { recursive: true });
  for (const base of opts.scriptFiles ?? []) {
    writeFileSync(join(cwd, `scripts/check-${base}.mjs`), '// dummy\n');
  }

  // scripts/meta/check-*.mjs (META-LEVEL — CANDID-045 D-5)
  mkdirSync(join(cwd, 'scripts/meta'), { recursive: true });
  for (const base of opts.metaScriptFiles ?? []) {
    writeFileSync(join(cwd, `scripts/meta/check-${base}.mjs`), '// dummy\n');
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
  it('package.json check:* 부재 → exit 1 + missing-package-script (continue invariant 동결)', () => {
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
    // T-2/T-6 in-PR fix: missing-package-script 시 `continue`로 partner 검증 스킵 동결
    expect(r.stderr).not.toContain('missing-script:');
    expect(r.stderr).not.toContain('missing-test:');
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

  it('meta-guard self-allowlist (scripts/meta/check-guard-wiring-consistency + check:guard-wiring) → orphan 분류 안 됨', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [],
        metaScriptFiles: ['guard-wiring-consistency'], // CANDID-045 D-5: META_DIR 배치
        testFiles: ['guard-wiring-consistency'],
        pkgScripts: { 'check:guard-wiring': 'node scripts/meta/check-guard-wiring-consistency.mjs' },
      }),
    );
    const r = runGuard(cwd);
    // 3개 self 항목 모두 보고되지 않아야 함 → exit 0
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('orphan');
  });

  it('T-5 in-PR fix: meta-guard self-integrity (self-test + self npm-script 동시 부재) → exit 1 (L-034 우회 차단)', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [],
        metaScriptFiles: ['guard-wiring-consistency'], // self-script만 존재 (META_DIR)
        testFiles: [], // self-test 부재
        pkgScripts: {}, // self npm-script 부재
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('meta-guard self-test missing');
    expect(r.stderr).toContain('meta-guard self npm-script missing');
    expect(r.stderr).toContain('L-034');
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
    // CANDID-045 D-1: exit 2 시 자체 경로(meta-guard) 보고.
    expect(r.stderr).toContain('meta-guard:');
    expect(r.stderr).toContain('scripts/meta/check-guard-wiring-consistency.mjs');
  });
});

describe('check-guard-wiring-consistency — CANDID-045 refinements', () => {
  it('D-6: 섹션 번호가 달라도(### 3.1.) 헤더 텍스트로 파싱 → exit 0', () => {
    const skill = [
      '# skill-review-pr',
      '',
      '### 3.1. Pre-Review Guard Execution',
      '',
      '| 파일 글롭 | npm script | 가드 ID | 도입 | 근거 |',
      '|-----------|------------|---------|------|------|',
      '| `prisma/migrations/**/migration.sql` | `pnpm check:migrations` | G-MIG | x | y |',
      '',
      '### 3.2. 다음 섹션',
      '',
    ].join('\n');
    const cwd = track(
      setupTempProject({
        skillTable: [],
        skillBodyOverride: skill,
        pkgScripts: { 'check:migrations': 'node scripts/check-migrations-no-concurrently.mjs' },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('1개 guard entry');
  });

  it('D-4: runner가 tsx여도 화이트리스트 통과 → exit 0', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: { 'check:migrations': 'tsx scripts/check-migrations-no-concurrently.mjs' },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
  });

  it('D-3: npm alias와 파일 base 의미 불일치 → exit 1 + alias-mismatch', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [{ glob: 'src/**', scriptCmd: 'pnpm check:foo', id: 'G-FOO' }],
        pkgScripts: { 'check:foo': 'node scripts/check-bar.mjs' },
        scriptFiles: ['bar'],
        testFiles: ['bar'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('alias-mismatch');
    // 정상 partner는 모두 존재하므로 missing-* 위반은 없어야 함.
    expect(r.stderr).not.toContain('missing-');
  });

  it('M-SEC: lifecycle hook(prepublishOnly)이 가드 스크립트 실행 → exit 1 + lifecycle-hook-guard-bypass', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: {
          'check:migrations': 'node scripts/check-migrations-no-concurrently.mjs',
          prepublishOnly: 'node scripts/check-migrations-no-concurrently.mjs',
        },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('lifecycle-hook-guard-bypass');
    expect(r.stderr).toContain('prepublishOnly');
  });
});

describe('check-guard-wiring-consistency — CANDID-045 review fix (negative/boundary)', () => {
  it('D-4 negative: 화이트리스트 외 runner(bash)는 거부 → exit 1 + invalid-package-script-command', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: { 'check:migrations': 'bash scripts/check-migrations-no-concurrently.mjs' },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('invalid-package-script-command');
  });

  it('M-SEC negative: 정상 lifecycle hook(postinstall: prisma generate)은 오탐 안 함 → exit 0', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: {
          'check:migrations': 'node scripts/check-migrations-no-concurrently.mjs',
          postinstall: 'prisma generate',
          prepare: 'husky install',
        },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('lifecycle-hook-guard-bypass');
  });

  it('M-SEC: lifecycle hook이 npm alias(pnpm check:*) 경유로 가드 실행해도 탐지 → exit 1', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [ROW_MIG],
        pkgScripts: {
          'check:migrations': 'node scripts/check-migrations-no-concurrently.mjs',
          postinstall: 'pnpm check:migrations',
        },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('lifecycle-hook-guard-bypass');
    expect(r.stderr).toContain('postinstall');
  });

  it('D-3 boundary: 첫 토큰/prefix 공유 시 느슨 매칭 통과 → exit 0 (의도된 거짓양성 회피 고정)', () => {
    // npm `check:migrations` ↔ 파일 base `migrations-no-concurrently` (hyphen-prefix 공유) → 통과.
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
    expect(r.stderr).not.toContain('alias-mismatch');
  });

  it('D-6 boundary: 섹션 번호가 전혀 없는 헤더(### Pre-Review Guard Execution)도 파싱 → exit 0', () => {
    const skill = [
      '# skill-review-pr',
      '',
      '### Pre-Review Guard Execution',
      '',
      '| 파일 글롭 | npm script | 가드 ID | 도입 | 근거 |',
      '|-----------|------------|---------|------|------|',
      '| `prisma/migrations/**/migration.sql` | `pnpm check:migrations` | G-MIG | x | y |',
      '',
      '### 다음 섹션',
      '',
    ].join('\n');
    const cwd = track(
      setupTempProject({
        skillTable: [],
        skillBodyOverride: skill,
        pkgScripts: { 'check:migrations': 'node scripts/check-migrations-no-concurrently.mjs' },
        scriptFiles: ['migrations-no-concurrently'],
        testFiles: ['migrations-no-concurrently'],
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('1개 guard entry');
  });

  it('D-5 orphan: scripts/meta/의 비-self 가드는 orphan-script로 검출 → exit 1 (SSOT 우회 차단)', () => {
    const cwd = track(
      setupTempProject({
        skillTable: [],
        metaScriptFiles: ['rogue-meta-guard'], // self 아님 + §2.4 표에 없음
      }),
    );
    const r = runGuard(cwd);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('orphan-script');
    expect(r.stderr).toContain('scripts/meta/check-rogue-meta-guard.mjs');
  });
});
