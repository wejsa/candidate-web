#!/usr/bin/env node
// CANDID-043: 회귀 가드 wiring meta-guard — 3종 세트(L-034 + L-036) 자동 일관성 검증.
//
// 4자 일치 검증 (binding 모델):
//   SKILL.md §2.4 row "pnpm {npm-script}"
//     → package.json scripts[{npm-script}] = "node scripts/check-{base}.mjs"
//     → scripts/check-{base}.mjs 존재 필수
//     → tests/scripts/check-{base}.test.ts 존재 필수 (L-034)
//
// package.json scripts entry가 SKILL.md ↔ 실제 파일 binding의 SSOT.
// npm script name(예: "check:migrations")과 실제 파일 base name(예:
// "migrations-no-concurrently")이 다를 수 있다 — npm alias 특성.
//
// 가정 (위반 시 exit 2 — 환경 오류):
//  - SKILL.md §2.4 헤더 텍스트: `### 2.4. Pre-Review Guard Execution`
//  - 표 컬럼 순서: `| 파일 글롭 | npm script | 가드 ID | ... |`
//  - 행 패턴: `| {글롭} | {script} | {id} | ... |`
//  - package.json scripts entry: `"check:{name}": "node scripts/check-{base}.mjs"`
//
// self-allowlist: meta-guard 자체(`scripts/check-guard-wiring-consistency.mjs` +
// `tests/scripts/check-guard-wiring-consistency.test.ts` + `package.json check:guard-wiring`)
// 는 §2.4 매핑 표에 등록되지 않음 — META-LEVEL은 preflight 통합 (USER-LEVEL과 구분).
//
// Exit: 0 = clean / 1 = 일관성 위반 / 2 = SKILL.md 파싱 실패.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_PATH = '.claude/skills/skill-review-pr/SKILL.md';
const SCRIPTS_DIR = 'scripts';
const TESTS_DIR = 'tests/scripts';
const PKG_PATH = 'package.json';

const META_SCRIPT_PATH = 'scripts/check-guard-wiring-consistency.mjs';
const META_TEST_PATH = 'tests/scripts/check-guard-wiring-consistency.test.ts';
const META_NPM_SCRIPT = 'check:guard-wiring';

const SECTION_HEADER_RX = /^### 2\.4\. Pre-Review Guard Execution\b/m;
const NEXT_SECTION_RX = /^### /m;
const ROW_RX = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([A-Z][A-Z0-9-]+)\s*\|/;
const PKG_VALUE_RX = /^node\s+(scripts\/check-[a-z0-9-]+\.mjs)$/;

function parseSkillTable(content) {
  const headerMatch = content.match(SECTION_HEADER_RX);
  if (!headerMatch) throw new Error('SKILL.md §"2.4. Pre-Review Guard Execution" 헤더 미발견');
  const startIdx = headerMatch.index + headerMatch[0].length;
  const rest = content.slice(startIdx);
  const nextMatch = rest.match(NEXT_SECTION_RX);
  const sectionBody = nextMatch ? rest.slice(0, nextMatch.index) : rest;
  const rows = [];
  for (const line of sectionBody.split('\n')) {
    const m = line.match(ROW_RX);
    if (!m) continue;
    rows.push({ glob: m[1], scriptCmd: m[2], guardId: m[3] });
  }
  return rows;
}

function parseNpmScriptName(scriptCmd) {
  const m = scriptCmd.match(/^pnpm\s+(?:run\s+)?(check:[a-z0-9-]+)$/);
  if (!m)
    throw new Error(`script command 파싱 실패: "${scriptCmd}" (기대: "pnpm [run] check:{name}")`);
  return m[1];
}

function listScriptFiles() {
  if (!existsSync(SCRIPTS_DIR)) return [];
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => /^check-[a-z0-9-]+\.mjs$/.test(f))
    .map((f) => `${SCRIPTS_DIR}/${f}`);
}

function listTestFiles() {
  if (!existsSync(TESTS_DIR)) return [];
  return readdirSync(TESTS_DIR)
    .filter((f) => /^check-[a-z0-9-]+\.test\.ts$/.test(f))
    .map((f) => `${TESTS_DIR}/${f}`);
}

function listPkgCheckScripts(pkg) {
  return Object.keys(pkg.scripts ?? {}).filter((k) => /^check:[a-z0-9-]+$/.test(k));
}

function deriveTestPathFromScript(scriptPath) {
  // scripts/check-foo.mjs → tests/scripts/check-foo.test.ts
  const base = scriptPath.replace(/^scripts\/check-/, '').replace(/\.mjs$/, '');
  return `${TESTS_DIR}/check-${base}.test.ts`;
}

try {
  const skillContent = readFileSync(SKILL_PATH, 'utf8');
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  const rows = parseSkillTable(skillContent);

  const violations = [];
  const activeScriptFiles = new Set();
  const activeTestFiles = new Set();
  const activeNpmScripts = new Set();

  // SKILL.md → package.json → file paths binding 검증
  for (const row of rows) {
    const npmScript = parseNpmScriptName(row.scriptCmd);
    activeNpmScripts.add(npmScript);
    const pkgValue = pkg.scripts?.[npmScript];
    if (!pkgValue) {
      violations.push(
        `missing-package-script: SKILL.md row "${row.guardId}" → package.json scripts["${npmScript}"] 부재`,
      );
      continue;
    }
    const m = pkgValue.match(PKG_VALUE_RX);
    if (!m) {
      violations.push(
        `invalid-package-script-command: package.json scripts["${npmScript}"] = "${pkgValue}" (기대: "node scripts/check-{base}.mjs")`,
      );
      continue;
    }
    const scriptPath = m[1];
    activeScriptFiles.add(scriptPath);
    if (!existsSync(scriptPath)) {
      violations.push(`missing-script: SKILL.md row "${row.guardId}" → ${scriptPath} 부재`);
    }
    const testPath = deriveTestPathFromScript(scriptPath);
    activeTestFiles.add(testPath);
    if (!existsSync(testPath)) {
      violations.push(
        `missing-test: SKILL.md row "${row.guardId}" → ${testPath} 부재 (L-034 — 가드 자체 단위 테스트 동반 필수)`,
      );
    }
  }

  // orphan 검출 (self-allowlist 적용)
  for (const file of listScriptFiles()) {
    if (file === META_SCRIPT_PATH) continue;
    if (!activeScriptFiles.has(file)) {
      violations.push(`orphan-script: ${file} 존재하나 SKILL.md §2.4 매핑 표에 row 없음`);
    }
  }
  for (const file of listTestFiles()) {
    if (file === META_TEST_PATH) continue;
    if (!activeTestFiles.has(file)) {
      violations.push(`orphan-test: ${file} 존재하나 SKILL.md §2.4 매핑 표에 대응 row 없음`);
    }
  }
  for (const npmScript of listPkgCheckScripts(pkg)) {
    if (npmScript === META_NPM_SCRIPT) continue;
    if (!activeNpmScripts.has(npmScript)) {
      violations.push(
        `orphan-package-script: package.json scripts["${npmScript}"] 존재하나 SKILL.md §2.4 row 없음`,
      );
    }
  }

  if (violations.length > 0) {
    console.error(`[check:guard-wiring] wiring 일관성 위반 ${violations.length}건 감지:`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `\n참조: _base/checklists/common.md §"회귀 가드 도구 도입" (L-034 + L-036).\n` +
        `대응: SKILL.md §2.4 매핑 표 ↔ package.json check:* ↔ scripts/check-*.mjs ↔ tests/scripts/check-*.test.ts 4자 일치 보장.`,
    );
    process.exit(1);
  }
  console.log(`[check:guard-wiring] OK — ${rows.length}개 guard entry 4자 일치 확인.`);
} catch (e) {
  console.error(`[check:guard-wiring] 환경 오류 (파싱 실패): ${e.message}`);
  console.error(
    `참조: scripts/check-guard-wiring-consistency.mjs 상단 가정 명시. SKILL.md §2.4 구조 변경 시 meta-guard도 동반 업데이트 필요.`,
  );
  process.exit(2);
}
