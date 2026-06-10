import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// CANDID-067: scripts/meta/normalize-backlog-schema.mjs (backlog.json 스키마 정규화) 검증.
// L-034 적용 — scripts/meta 가드는 자체 vitest 동반 필수(sibling check-guard-wiring-consistency와 동일).
// allowJs:false라 .mjs 직접 import는 typecheck를 깨므로, sibling 패턴대로 스폰 기반 fixture 테스트.
// BACKLOG_JSON_PATH env로 대상 경로를 fixture에 주입한다.

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/meta/normalize-backlog-schema.mjs');

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

/** fixture backlog를 임시 파일로 쓰고 경로 반환. */
function writeFixture(backlog: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'candid-067-'));
  tmpDirs.push(dir);
  const path = join(dir, 'backlog.json');
  writeFileSync(path, JSON.stringify(backlog, null, 2) + '\n');
  return path;
}

/** 스크립트 실행. {code, stdout} 반환(비-0 exit에도 throw 안 함). */
function run(path: string, args: string[] = []): { code: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH, ...args], {
      env: { ...process.env, BACKLOG_JSON_PATH: path },
      encoding: 'utf8',
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

type StepObj = Record<string, unknown>;
type TaskObj = Record<string, unknown> & { steps?: StepObj[] };

function readBacklog(path: string): {
  metadata?: { version?: number };
  tasks: Record<string, TaskObj>;
} {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** task 접근 헬퍼 — noUncheckedIndexedAccess 하에서 undefined 가드 + 부재 시 명확 실패. */
function getTask(path: string, id = 'CANDID-001'): TaskObj {
  const t = readBacklog(path).tasks[id];
  if (!t) throw new Error(`task ${id} not found in ${path}`);
  return t;
}

/** 최소 유효 task 골격. */
function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'CANDID-001',
    title: 't',
    status: 'done',
    priority: 'high',
    createdAt: '2026-01-01T00:00:00+09:00',
    ...overrides,
  };
}

function baseBacklog(tasks: Record<string, unknown>): unknown {
  return { metadata: { version: 1 }, tasks };
}

describe('normalize-backlog-schema (CANDID-067)', () => {
  describe('step.number 보정', () => {
    it('number가 이미 있으면 그대로 둔다', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({ steps: [{ number: 5, title: 's', status: 'merged' }] }),
        }),
      );
      run(path);
      expect(getTask(path).steps?.[0]?.number).toBe(5);
    });

    it('레거시 step 키를 number로 승계한다', () => {
      const path = writeFixture(
        baseBacklog({ 'CANDID-001': task({ steps: [{ step: 3, title: 's', status: 'merged' }] }) }),
      );
      run(path);
      const s = getTask(path).steps?.[0];
      expect(s?.number).toBe(3);
      expect(s?.step).toBeUndefined();
    });

    it('레거시 stepNumber 키를 number로 승계한다(인덱스 추론보다 우선)', () => {
      // 배열 순서와 stepNumber가 어긋난 경우에도 정상값을 승계해야 함(취약성 회귀 가드).
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            steps: [
              { stepNumber: 2, title: 'a', status: 'merged' },
              { stepNumber: 1, title: 'b', status: 'merged' },
            ],
          }),
        }),
      );
      run(path);
      const steps = getTask(path).steps ?? [];
      expect(steps.map((s) => s.number)).toEqual([2, 1]);
      expect(steps.every((s) => s.stepNumber === undefined)).toBe(true);
    });

    it('number/step/stepNumber 모두 없으면 인덱스+1을 부여한다', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            steps: [
              { title: 'a', status: 'merged' },
              { title: 'b', status: 'merged' },
            ],
          }),
        }),
      );
      run(path);
      expect((getTask(path).steps ?? []).map((s) => s.number)).toEqual([1, 2]);
    });
  });

  describe('필드/타입 정규화', () => {
    it('화이트리스트 외 task/step 필드를 제거한다', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            source: 'legacy',
            planPath: '.claude/temp/x.md',
            steps: [
              {
                number: 1,
                title: 's',
                status: 'merged',
                branch: 'feature/x',
                actualLines: 100,
                reviewSummary: '...',
              },
            ],
          }),
        }),
      );
      run(path);
      const t = getTask(path);
      expect(t.source).toBeUndefined();
      expect(t.planPath).toBeUndefined();
      const s = t.steps?.[0];
      expect(s?.branch).toBeUndefined();
      expect(s?.actualLines).toBeUndefined();
      expect(s?.reviewSummary).toBeUndefined();
      // 정상 필드는 보존
      expect(s?.number).toBe(1);
      expect(s?.title).toBe('s');
    });

    it('prLineLimit > 1000을 1000으로 클램프한다', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            steps: [{ number: 1, title: 's', status: 'merged', prLineLimit: 1300 }],
          }),
        }),
      );
      run(path);
      expect(getTask(path).steps?.[0]?.prLineLimit).toBe(1000);
    });

    it('prLineLimit 경계(=1000)와 그 미만은 클램프하지 않는다(off-by-one 가드)', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            steps: [
              { number: 1, title: 'a', status: 'merged', prLineLimit: 1000 },
              { number: 2, title: 'b', status: 'merged', prLineLimit: 450 },
            ],
          }),
        }),
      );
      run(path);
      const steps = getTask(path).steps ?? [];
      expect(steps.map((s) => s.prLineLimit)).toEqual([1000, 450]);
    });

    it('workflowState:null인 task를 NPE 없이 보존한다', () => {
      const path = writeFixture(baseBacklog({ 'CANDID-001': task({ workflowState: null }) }));
      run(path);
      expect(getTask(path).workflowState).toBeNull();
    });

    it('workflowState.autoChainArgs가 string이면 보존한다', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            status: 'in_progress',
            workflowState: {
              currentSkill: 'aick-impl',
              autoChainArgs: '168 --auto-fix',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        }),
      );
      run(path);
      const ws = getTask(path).workflowState as Record<string, unknown>;
      expect(ws.autoChainArgs).toBe('168 --auto-fix');
    });

    it('specFile:null을 제거한다', () => {
      const path = writeFixture(baseBacklog({ 'CANDID-001': task({ specFile: null }) }));
      run(path);
      expect('specFile' in getTask(path)).toBe(false);
    });

    it('currentStep 0/null을 최대 step.number로 보정한다', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            currentStep: 0,
            steps: [
              { number: 1, title: 'a', status: 'merged' },
              { number: 2, title: 'b', status: 'merged' },
            ],
          }),
        }),
      );
      run(path);
      expect(getTask(path).currentStep).toBe(2);
    });

    it('currentStep 0 + steps 없으면 키를 제거한다', () => {
      const path = writeFixture(baseBacklog({ 'CANDID-001': task({ currentStep: 0 }) }));
      run(path);
      expect('currentStep' in getTask(path)).toBe(false);
    });

    it('workflowState.autoChainArgs:null 키를 제거한다', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            status: 'in_progress',
            workflowState: {
              currentSkill: 'aick-impl',
              autoChainArgs: null,
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        }),
      );
      run(path);
      const ws = getTask(path).workflowState as Record<string, unknown>;
      expect('autoChainArgs' in ws).toBe(false);
      expect(ws.currentSkill).toBe('aick-impl');
    });
  });

  describe('멱등성 + --check 가드', () => {
    it('정규화 후 재실행은 변경 없음(멱등)이며 version을 올리지 않는다', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            source: 'legacy',
            steps: [{ step: 1, title: 's', status: 'merged' }],
          }),
        }),
      );
      run(path); // 1회차 적용 (version 1 → 2)
      const afterFirst = readBacklog(path).metadata?.version;
      const second = run(path); // 2회차
      expect(second.stdout).toContain('변경 없음');
      expect(readBacklog(path).metadata?.version).toBe(afterFirst); // version 불변
    });

    it('--check는 정합 파일에 exit 0', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({ steps: [{ number: 1, title: 's', status: 'merged' }] }),
        }),
      );
      expect(run(path, ['--check']).code).toBe(0);
    });

    it('--check는 위반 파일에 exit 1 + 파일 미변경(부수효과 없음)', () => {
      const path = writeFixture(
        baseBacklog({
          'CANDID-001': task({
            source: 'legacy',
            steps: [{ step: 1, title: 's', status: 'merged' }],
          }),
        }),
      );
      const before = readFileSync(path, 'utf8');
      const res = run(path, ['--check']);
      expect(res.code).toBe(1);
      // --check는 파일을 건드리지 않는다(deep-copy 순수 검사)
      expect(readFileSync(path, 'utf8')).toBe(before);
    });
  });

  describe('SSOT 드리프트 가드 (화이트리스트 키셋 핀)', () => {
    // backlog.schema.json definitions.task/step의 properties 키 스냅샷.
    // 스키마가 vendoring되지 않아 스크립트가 하드코딩하므로, 이 핀이 유일한 드리프트 탐지선.
    // 스키마 확장 시 스크립트 TASK_KEYS/STEP_KEYS와 이 상수를 함께 갱신해야 테스트가 통과한다.
    const EXPECTED_TASK_KEYS = [
      'assignedAt',
      'assignee',
      'completedAt',
      'createdAt',
      'currentStep',
      'dependencies',
      'description',
      'id',
      'lockTTL',
      'lockedAt',
      'lockedBy',
      'lockedFiles',
      'micro',
      'pauseReason',
      'pausedAt',
      'phase',
      'priority',
      'specFile',
      'status',
      'steps',
      'title',
      'type',
      'updatedAt',
      'workflowState',
    ];
    const EXPECTED_STEP_KEYS = [
      'description',
      'estimatedLines',
      'files',
      'mergedAt',
      'number',
      'prLineLimit',
      'prNumber',
      'status',
      'title',
    ];

    it('--print-keys가 스크립트 화이트리스트를 스냅샷대로 노출한다', () => {
      const path = writeFixture(baseBacklog({}));
      const { stdout } = run(path, ['--print-keys']);
      const keys = JSON.parse(stdout) as { taskKeys: string[]; stepKeys: string[] };
      expect(keys.taskKeys).toEqual(EXPECTED_TASK_KEYS);
      expect(keys.stepKeys).toEqual(EXPECTED_STEP_KEYS);
    });
  });
});
