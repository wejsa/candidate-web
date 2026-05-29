#!/usr/bin/env node
// CANDID-043: 회귀 가드 wiring meta-guard — 3종 세트(L-034 + L-036) 자동 일관성 검증.
// CANDID-045: META 가드 디렉토리 분리(scripts/meta/, D-5) + 헤더 텍스트 매칭(섹션 재배치 견고성, D-6)
//   + runner 화이트리스트 node|tsx(D-4) + alias 의미 매칭 룰(D-3) + lifecycle-hook 보안 가드(M-SEC)
//   + exit 2 self 경로 보고(D-1).
//
// 4자 일치 검증 (binding 모델):
//   SKILL.md §"Pre-Review Guard Execution" row "pnpm {npm-script}"
//     → package.json scripts[{npm-script}] = "node|tsx scripts/check-{base}.mjs"
//     → scripts/check-{base}.mjs 존재 필수
//     → tests/scripts/check-{base}.test.ts 존재 필수 (L-034)
//
// package.json scripts entry가 SKILL.md ↔ 실제 파일 binding의 SSOT.
// npm script name(예: "check:migrations")과 파일 base("migrations-no-concurrently")는 다를 수 있으나,
// 의미적으로(첫 토큰/prefix 공유) 매칭되어야 한다 — alias 무분별 사용 차단(D-3).
//
// USER-LEVEL 가드는 `scripts/` 최상위, META-LEVEL 가드(본 파일)는 `scripts/meta/` — 디렉토리로 구분(D-5).
//
// 가정 (위반 시 exit 2 — 환경 오류):
//  - SKILL.md 헤더 텍스트: `### [번호] Pre-Review Guard Execution` (섹션 번호는 매칭에서 제외, D-6)
//  - 표 컬럼 순서: `| 파일 글롭 | npm script | 가드 ID | ... |`
//  - 행 패턴: `| {글롭} | {script} | {id} | ... |`
//  - package.json scripts entry: `"check:{name}": "node|tsx scripts/check-{base}.mjs"`
//
// self-allowlist: meta-guard 자체(`scripts/meta/check-guard-wiring-consistency.mjs` +
// `tests/scripts/check-guard-wiring-consistency.test.ts` + `package.json check:guard-wiring`)
// 는 §"Pre-Review Guard Execution" 매핑 표에 등록되지 않음 — META-LEVEL은 preflight 통합.
//
// Exit: 0 = clean / 1 = 일관성 위반 / 2 = SKILL.md 파싱 실패.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_PATH = '.claude/skills/skill-review-pr/SKILL.md';
const SCRIPTS_DIR = 'scripts';
const META_DIR = 'scripts/meta'; // CANDID-045 D-5: META-LEVEL 가드 격리 디렉토리
const TESTS_DIR = 'tests/scripts';
const PKG_PATH = 'package.json';

// CANDID-045 M-SEC: npm lifecycle hook(implicit 실행)이 가드 스크립트를 호출하면 §2.4 표 SSOT를
// 우회한다 — 가드는 명시적 check:* 엔트리로만 호출되어야 한다.
const NPM_LIFECYCLE_HOOKS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepublishOnly',
  'prepare',
  'prepack',
  'postpack',
  'preuninstall',
  'uninstall',
  'postuninstall',
]);

// D-2/T-5 in-PR fix: 동적 self-detection — `import.meta.url` 기반 SELF_BASE 도출 (L-042).
// 파일 rename(상수 stale silent failure) 차단 + self-test 부재(L-034 위반) 명시적 보고.
// CANDID-045 D-5: self는 META_DIR에 위치 — canonical 경로로 fixture + 실 프로젝트 일관 동작.
const SELF_BASE = basename(fileURLToPath(import.meta.url))
  .replace(/^check-/, '')
  .replace(/\.mjs$/, '');
const SELF_SCRIPT_PATH = `${META_DIR}/check-${SELF_BASE}.mjs`;
const SELF_TEST_PATH = `${TESTS_DIR}/check-${SELF_BASE}.test.ts`;

// CANDID-045 D-6: 섹션 번호("2.4.")를 매칭에서 제외 — 헤더 텍스트만 사용해 섹션 재배치에 견고.
const SECTION_HEADER_RX = /^###\s+(?:[\d.]+\.?\s+)?Pre-Review Guard Execution\b/m;
const NEXT_SECTION_RX = /^### /m;
const ROW_RX = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([A-Z][A-Z0-9-]+)\s*\|/;
// CANDID-045 D-4: runner 화이트리스트 — node 외 tsx 등 허용. 그 외 임의 명령은 거부(공급망 방어).
const PKG_VALUE_RX = /^(?:node|tsx)\s+(scripts\/check-[a-z0-9-]+\.mjs)$/;

// CANDID-045 D-3: npm alias({name})와 파일 base가 의미적으로 매칭되는지 검증.
// 동일하거나, 한쪽이 다른쪽의 hyphen-prefix이거나, 첫 토큰을 공유하면 통과(느슨 매칭 — 거짓양성 회피).
function aliasMatches(npmScript, scriptBase) {
  const n = npmScript.replace(/^check:/, '');
  if (scriptBase === n) return true;
  if (scriptBase.startsWith(`${n}-`)) return true; // 예: migrations ↔ migrations-no-concurrently
  if (n.startsWith(`${scriptBase}-`)) return true;
  return scriptBase.split('-')[0] === n.split('-')[0];
}

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

  // D-2/T-5 in-PR fix: self npm script entry 동적 탐색.
  const SELF_NPM_SCRIPT = Object.entries(pkg.scripts ?? {}).find(
    ([, v]) => v === `node ${SELF_SCRIPT_PATH}`,
  )?.[0];

  const violations = [];

  // T-5 in-PR fix: meta-guard self-integrity 명시 검증 (L-034 self-application 우회 회피).
  // canonical SELF_SCRIPT_PATH가 cwd에 존재할 때만 실행 (production에선 항상 존재, fixture는
  // 자체적으로 self 파일을 만들 때만 trigger). rename 회귀는 SELF_BASE 동적 도출로 차단됨.
  if (existsSync(SELF_SCRIPT_PATH)) {
    if (!existsSync(SELF_TEST_PATH)) {
      violations.push(
        `meta-guard self-test missing: ${SELF_TEST_PATH} 부재 — L-034 self-application 위반`,
      );
    }
    if (!SELF_NPM_SCRIPT) {
      violations.push(
        `meta-guard self npm-script missing: package.json scripts에 value === "node ${SELF_SCRIPT_PATH}"인 entry 부재`,
      );
    }
  }

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
    // CANDID-045 D-3: npm alias ↔ 파일 base 의미 매칭 (무분별 alias 차단).
    const scriptBase = scriptPath.replace(/^scripts\/check-/, '').replace(/\.mjs$/, '');
    if (!aliasMatches(npmScript, scriptBase)) {
      violations.push(
        `alias-mismatch: npm script "${npmScript}" ↔ 파일 base "${scriptBase}" 의미 불일치 ` +
          `(alias는 파일 base와 첫 토큰 또는 hyphen-prefix를 공유해야 함)`,
      );
    }
  }

  // orphan 검출. CANDID-045 D-5 이후 self는 META_DIR(scripts/meta/)에 있어
  // listScriptFiles(scripts/ 최상위)에 잡히지 않음 — self-allowlist는 defense-in-depth로 유지.
  for (const file of listScriptFiles()) {
    if (file === SELF_SCRIPT_PATH) continue;
    if (!activeScriptFiles.has(file)) {
      violations.push(`orphan-script: ${file} 존재하나 SKILL.md §2.4 매핑 표에 row 없음`);
    }
  }
  for (const file of listTestFiles()) {
    if (file === SELF_TEST_PATH) continue;
    if (!activeTestFiles.has(file)) {
      violations.push(`orphan-test: ${file} 존재하나 SKILL.md §2.4 매핑 표에 대응 row 없음`);
    }
  }
  for (const npmScript of listPkgCheckScripts(pkg)) {
    if (npmScript === SELF_NPM_SCRIPT) continue;
    if (!activeNpmScripts.has(npmScript)) {
      violations.push(
        `orphan-package-script: package.json scripts["${npmScript}"] 존재하나 SKILL.md §2.4 row 없음`,
      );
    }
  }

  // CANDID-045 M-SEC: lifecycle hook이 가드 스크립트를 암묵 실행 → §2.4 표 SSOT 우회 차단.
  const GUARD_REF_RX = /(?:^|[\s/])scripts\/(?:meta\/)?check-[a-z0-9-]+\.mjs\b/;
  for (const [name, value] of Object.entries(pkg.scripts ?? {})) {
    if (!NPM_LIFECYCLE_HOOKS.has(name)) continue;
    if (typeof value === 'string' && GUARD_REF_RX.test(value)) {
      violations.push(
        `lifecycle-hook-guard-bypass: package.json lifecycle hook "${name}"이 가드 스크립트를 실행 — ` +
          `가드는 §2.4 표에 등록된 check:* 엔트리로만 호출해야 함 (암묵 실행 우회 차단)`,
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
  // CANDID-045 D-1: 어떤 meta-guard가 보고했는지 자체 경로 명시 (디버깅 단서).
  console.error(`  meta-guard: ${SELF_SCRIPT_PATH}`);
  console.error(
    `참조: ${SELF_SCRIPT_PATH} 상단 가정 명시. SKILL.md §"Pre-Review Guard Execution" 구조 변경 시 meta-guard도 동반 업데이트 필요.`,
  );
  process.exit(2);
}
