#!/usr/bin/env node
// CANDID-067 — backlog.json 스키마 정합성 정규화 (일회성·멱등·결정적)
//
// ai-crew-kit backlog.schema.json(definitions.task / definitions.step,
// additionalProperties:false)에 맞춰 구버전 kit(2.x)이 남긴 비표준 필드/누락 필드/
// 타입 위반을 정리한다. 제거되는 레거시 필드(branch/reviewSummary/note 등)는 git
// 히스토리 + completed.json + docs/retro/에 보존되므로 파괴적 손실이 아니다.
//
// 사용: node scripts/meta/normalize-backlog-schema.mjs [--check]
//   --check: 변경 없이 위반 카운트만 출력(exit 1 if 변경 필요) — CI 가드용
//
// 멱등성: 2회차 실행은 "변경 없음"을 출력하고 파일을 건드리지 않는다.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKLOG_PATH = resolve(__dirname, '../../.claude/state/backlog.json');

// backlog.schema.json definitions.task / definitions.step 의 properties 키 (SSOT).
// 스키마가 확장되면 이 목록도 함께 갱신해야 한다.
const TASK_KEYS = new Set([
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
const STEP_KEYS = new Set([
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
const STEP_PR_LINE_LIMIT_MAX = 1000; // schema definitions.step.prLineLimit.maximum

const counts = {
  stepKeyRenamed: 0, // step → number
  stepNumberFromIndex: 0, // number/step 모두 부재 → 인덱스 기반 부여
  taskFieldsRemoved: {}, // fieldName → count
  stepFieldsRemoved: {}, // fieldName → count
  specFileNullRemoved: 0,
  currentStepFixed: 0,
  currentStepRemoved: 0,
  prLineLimitClamped: 0,
  workflowNullPruned: 0, // workflowState의 non-nullable null 키 제거
};

function bump(bag, key) {
  bag[key] = (bag[key] ?? 0) + 1;
}

function normalizeStep(step, index) {
  // 1. number 보정: number 우선, 없으면 step 키, 그것도 없으면 배열 인덱스+1
  if (step.number === undefined) {
    if (step.step !== undefined) {
      step.number = step.step;
      counts.stepKeyRenamed += 1;
    } else {
      step.number = index + 1;
      counts.stepNumberFromIndex += 1;
    }
  }
  // 5. prLineLimit 클램프
  if (typeof step.prLineLimit === 'number' && step.prLineLimit > STEP_PR_LINE_LIMIT_MAX) {
    step.prLineLimit = STEP_PR_LINE_LIMIT_MAX;
    counts.prLineLimitClamped += 1;
  }
  // 2. 화이트리스트 외 키 제거 (step 키 포함)
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

function normalizeTask(task) {
  // steps 정규화 (배열 순서 보존, 인덱스 전달)
  if (Array.isArray(task.steps)) {
    task.steps = task.steps.map((s, i) => normalizeStep(s, i));
  }

  // workflowState: autoChainArgs는 스키마상 string-only(nullable 아님) →
  // null이면 키 생략(skill이 빈 체인 인자를 null로 기록한 드리프트 해소).
  if (task.workflowState && typeof task.workflowState === 'object') {
    if (task.workflowState.autoChainArgs === null) {
      delete task.workflowState.autoChainArgs;
      counts.workflowNullPruned += 1;
    }
  }

  // 3. specFile: null → 키 제거 (schema type string)
  if (task.specFile === null) {
    delete task.specFile;
    counts.specFileNullRemoved += 1;
  }

  // 4. currentStep null/0 보정
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

  // 2. 화이트리스트 외 task 키 제거
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

function main() {
  const checkOnly = process.argv.includes('--check');
  const raw = readFileSync(BACKLOG_PATH, 'utf8');
  const before = JSON.parse(raw);

  const after = { ...before };
  const tasks = after.tasks ?? {};
  for (const id of Object.keys(tasks)) {
    tasks[id] = normalizeTask(tasks[id]);
  }

  const totalRemoved =
    Object.values(counts.taskFieldsRemoved).reduce((a, b) => a + b, 0) +
    Object.values(counts.stepFieldsRemoved).reduce((a, b) => a + b, 0);
  const changed =
    counts.stepKeyRenamed > 0 ||
    counts.stepNumberFromIndex > 0 ||
    totalRemoved > 0 ||
    counts.specFileNullRemoved > 0 ||
    counts.currentStepFixed > 0 ||
    counts.currentStepRemoved > 0 ||
    counts.prLineLimitClamped > 0 ||
    counts.workflowNullPruned > 0;

  // 리포트
  const sortBag = (bag) =>
    Object.entries(bag)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}(${v})`)
      .join(', ');
  console.log('=== backlog.json 스키마 정규화 리포트 ===');
  console.log(`step 키 → number 개명      : ${counts.stepKeyRenamed}`);
  console.log(`step number 인덱스 부여    : ${counts.stepNumberFromIndex}`);
  console.log(
    `task 비표준 필드 제거      : ${Object.values(counts.taskFieldsRemoved).reduce((a, b) => a + b, 0)}  [${sortBag(counts.taskFieldsRemoved) || '-'}]`,
  );
  console.log(
    `step 비표준 필드 제거      : ${Object.values(counts.stepFieldsRemoved).reduce((a, b) => a + b, 0)}  [${sortBag(counts.stepFieldsRemoved) || '-'}]`,
  );
  console.log(`specFile:null 제거         : ${counts.specFileNullRemoved}`);
  console.log(
    `currentStep 보정/제거      : ${counts.currentStepFixed}/${counts.currentStepRemoved}`,
  );
  console.log(`prLineLimit 클램프(>1000)  : ${counts.prLineLimitClamped}`);
  console.log(`workflowState null 키 제거 : ${counts.workflowNullPruned}`);

  if (!changed) {
    console.log('\n변경 없음 — 이미 스키마 정합 상태입니다.');
    return 0;
  }

  if (checkOnly) {
    console.log('\n[--check] 정규화 필요 — backlog.json이 스키마와 불일치합니다.');
    return 1;
  }

  // metadata 갱신
  after.metadata = after.metadata ?? {};
  after.metadata.version = (after.metadata.version ?? 0) + 1;
  after.metadata.updatedAt = new Date().toISOString();

  writeFileSync(BACKLOG_PATH, JSON.stringify(after, null, 2) + '\n');
  console.log(`\n정규화 완료 — metadata.version → ${after.metadata.version}`);
  return 0;
}

process.exit(main());
