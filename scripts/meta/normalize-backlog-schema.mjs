#!/usr/bin/env node
// CANDID-067 — backlog.json 스키마 정합성 정규화 (멱등·결정적)
//
// ai-crew-kit backlog.schema.json(definitions.task / definitions.step,
// additionalProperties:false)에 맞춰 구버전 kit(2.x)이 남긴 비표준 필드/누락 필드/
// 타입 위반을 정리한다. 제거되는 레거시 필드(branch/reviewSummary/note 등)는 git
// 히스토리에 그대로 보존되므로 파괴적 손실이 아니다.
//
// 사용:
//   node scripts/meta/normalize-backlog-schema.mjs           정규화 적용 (파일 갱신)
//   node scripts/meta/normalize-backlog-schema.mjs --check   변경 없이 검사만 (위반 시 exit 1)
//
// --check는 `npm run check:backlog-schema`로 배선되어 CI/회귀 가드로 동작한다.
// 멱등성: 2회차 실행은 "변경 없음"을 출력하고 파일을 건드리지 않는다.
//
// 순수 함수(normalizeBacklog/normalizeTask/normalizeStep)는 export되어
// tests/scripts/normalize-backlog-schema.test.ts에서 직접 검증한다(L-034).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 기본 대상은 레포 상태 파일. BACKLOG_JSON_PATH로 오버라이드 가능(테스트 fixture 주입용).
const BACKLOG_PATH =
  process.env.BACKLOG_JSON_PATH || resolve(__dirname, '../../.claude/state/backlog.json');

// backlog.schema.json definitions.task / definitions.step 의 properties 키 (의도된 스냅샷).
// 스키마는 플러그인 캐시에만 존재하고 본 레포에 vendoring되지 않으므로 런타임 파생 대신
// 하드코딩한다. 스키마가 확장되면 이 목록 + 테스트의 핀(EXPECTED_*_KEYS)을 함께 갱신해야
// 한다 — 테스트가 스냅샷을 고정하므로 변경은 반드시 의식적인 테스트 수정을 동반한다.
export const TASK_KEYS = new Set([
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
]);
export const STEP_KEYS = new Set([
  'description',
  'estimatedLines',
  'files',
  'mergedAt',
  'number',
  'prLineLimit',
  'prNumber',
  'status',
  'title',
]);
export const STEP_PR_LINE_LIMIT_MAX = 1000; // schema definitions.step.prLineLimit.maximum
// number 부재 시 승계할 레거시 별칭(우선순위 순). 인덱스 추론은 최후 수단.
const STEP_NUMBER_ALIASES = ['step', 'stepNumber'];

export function createCounts() {
  return {
    stepKeyRenamed: 0, // 레거시 별칭(step/stepNumber) → number 승계
    stepNumberFromIndex: 0, // 별칭도 부재 → 인덱스 기반 부여
    taskFieldsRemoved: {}, // fieldName → count
    stepFieldsRemoved: {}, // fieldName → count
    specFileNullRemoved: 0,
    currentStepFixed: 0,
    currentStepRemoved: 0,
    prLineLimitClamped: 0,
    workflowNullPruned: 0, // workflowState의 non-nullable null 키 제거
  };
}

function bump(bag, key) {
  bag[key] = (bag[key] ?? 0) + 1;
}

export function normalizeStep(step, index, counts) {
  // 1. number 보정: number 우선 → 레거시 별칭(step, stepNumber) → 인덱스+1(최후)
  if (step.number === undefined) {
    const alias = STEP_NUMBER_ALIASES.map((k) => step[k]).find((v) => typeof v === 'number');
    if (alias !== undefined) {
      step.number = alias;
      counts.stepKeyRenamed += 1;
    } else {
      step.number = index + 1;
      counts.stepNumberFromIndex += 1;
    }
  }
  // 2. prLineLimit 클램프
  if (typeof step.prLineLimit === 'number' && step.prLineLimit > STEP_PR_LINE_LIMIT_MAX) {
    step.prLineLimit = STEP_PR_LINE_LIMIT_MAX;
    counts.prLineLimitClamped += 1;
  }
  // 3. 화이트리스트 외 키 제거 (step/stepNumber 등 레거시 별칭 포함)
  const cleaned = {};
  for (const key of Object.keys(step)) {
    if (STEP_KEYS.has(key)) {
      cleaned[key] = step[key];
    } else {
      bump(counts.stepFieldsRemoved, key);
    }
  }
  return cleaned;
}

export function normalizeTask(task, counts) {
  // steps 정규화 (배열 순서 보존, 인덱스 전달)
  if (Array.isArray(task.steps)) {
    task.steps = task.steps.map((s, i) => normalizeStep(s, i, counts));
  }

  // workflowState: autoChainArgs는 스키마상 string-only(nullable 아님) →
  // null이면 키 생략(skill이 빈 체인 인자를 null로 기록한 드리프트 해소).
  if (task.workflowState && typeof task.workflowState === 'object') {
    if (task.workflowState.autoChainArgs === null) {
      delete task.workflowState.autoChainArgs;
      counts.workflowNullPruned += 1;
    }
  }

  // specFile: null → 키 제거 (schema type string)
  if (task.specFile === null) {
    delete task.specFile;
    counts.specFileNullRemoved += 1;
  }

  // currentStep null/0 보정 → 최대 step.number, steps 없으면 키 제거
  if (task.currentStep === null || task.currentStep === 0) {
    const maxNum = Array.isArray(task.steps)
      ? task.steps.reduce((m, s) => (typeof s.number === 'number' ? Math.max(m, s.number) : m), 0)
      : 0;
    if (maxNum > 0) {
      task.currentStep = maxNum;
      counts.currentStepFixed += 1;
    } else {
      delete task.currentStep;
      counts.currentStepRemoved += 1;
    }
  }

  // 화이트리스트 외 task 키 제거
  const cleaned = {};
  for (const key of Object.keys(task)) {
    if (TASK_KEYS.has(key)) {
      cleaned[key] = task[key];
    } else {
      bump(counts.taskFieldsRemoved, key);
    }
  }
  return cleaned;
}

export function totalRemoved(counts) {
  return (
    Object.values(counts.taskFieldsRemoved).reduce((a, b) => a + b, 0) +
    Object.values(counts.stepFieldsRemoved).reduce((a, b) => a + b, 0)
  );
}

export function isChanged(counts) {
  return (
    counts.stepKeyRenamed > 0 ||
    counts.stepNumberFromIndex > 0 ||
    totalRemoved(counts) > 0 ||
    counts.specFileNullRemoved > 0 ||
    counts.currentStepFixed > 0 ||
    counts.currentStepRemoved > 0 ||
    counts.prLineLimitClamped > 0 ||
    counts.workflowNullPruned > 0
  );
}

// 순수 함수: 파싱된 backlog 객체를 받아 정규화 결과를 새 객체로 반환한다.
// 입력을 변형하지 않으므로(deep copy) --check 모드가 부수효과 없는 순수 검사가 된다.
export function normalizeBacklog(backlog) {
  const counts = createCounts();
  const result = JSON.parse(JSON.stringify(backlog)); // deep copy — 입력 불변
  const tasks = result.tasks ?? {};
  for (const id of Object.keys(tasks)) {
    tasks[id] = normalizeTask(tasks[id], counts);
  }
  return { result, counts, changed: isChanged(counts) };
}

function formatReport(counts) {
  const sortBag = (bag) =>
    Object.entries(bag)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}(${v})`)
      .join(', ');
  const taskRemoved = Object.values(counts.taskFieldsRemoved).reduce((a, b) => a + b, 0);
  const stepRemoved = Object.values(counts.stepFieldsRemoved).reduce((a, b) => a + b, 0);
  return [
    '=== backlog.json 스키마 정규화 리포트 ===',
    `step 별칭 → number 승계    : ${counts.stepKeyRenamed}`,
    `step number 인덱스 부여    : ${counts.stepNumberFromIndex}`,
    `task 비표준 필드 제거      : ${taskRemoved}  [${sortBag(counts.taskFieldsRemoved) || '-'}]`,
    `step 비표준 필드 제거      : ${stepRemoved}  [${sortBag(counts.stepFieldsRemoved) || '-'}]`,
    `specFile:null 제거         : ${counts.specFileNullRemoved}`,
    `currentStep 보정/제거      : ${counts.currentStepFixed}/${counts.currentStepRemoved}`,
    `prLineLimit 클램프(>1000)  : ${counts.prLineLimitClamped}`,
    `workflowState null 키 제거 : ${counts.workflowNullPruned}`,
  ].join('\n');
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const raw = readFileSync(BACKLOG_PATH, 'utf8');
  const { result, counts, changed } = normalizeBacklog(JSON.parse(raw));

  console.log(formatReport(counts));

  if (!changed) {
    console.log('\n변경 없음 — 이미 스키마 정합 상태입니다.');
    return 0;
  }

  if (checkOnly) {
    console.log('\n[--check] 정규화 필요 — backlog.json이 스키마와 불일치합니다.');
    console.log('해결: node scripts/meta/normalize-backlog-schema.mjs');
    return 1;
  }

  // metadata 갱신 후 파일 쓰기 (정규화 적용 모드에서만)
  result.metadata = result.metadata ?? {};
  result.metadata.version = (result.metadata.version ?? 0) + 1;
  result.metadata.updatedAt = new Date().toISOString();

  writeFileSync(BACKLOG_PATH, JSON.stringify(result, null, 2) + '\n');
  console.log(`\n정규화 완료 — metadata.version → ${result.metadata.version}`);
  return 0;
}

// 직접 실행 시에만 main() 수행 — 테스트가 import할 때는 순수 함수만 노출.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
