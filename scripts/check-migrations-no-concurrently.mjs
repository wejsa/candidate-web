#!/usr/bin/env node
// CANDID-038: prisma migration.sql에서 신규 `CREATE INDEX CONCURRENTLY` 검출 (L-029 회귀 차단).
//
// 매칭 전략 (in-PR fix D-MAJOR-1/2 + S-MAJOR-1):
//  1) 파일 내용에서 `-- ...` 라인 주석 + `/* ... */` 블록 주석을 먼저 제거 (false negative/positive 방지).
//  2) 정규식은 라인 단위가 아닌 *파일 전체*에 적용 → `CREATE INDEX\n  CONCURRENTLY ...` 같은
//     멀티라인 SQL 포맷도 검출 (PostgreSQL은 토큰 사이 줄바꿈 허용).
//  3) 매치 위치(`match.index`)로 원본 파일 기준 라인 번호 재계산.
// allowlist: `.claude/state/migration-concurrently-allowlist.txt` (한 줄당 파일 경로).
//
// Exit: 0 = clean, 1 = 신규 detection, 2 = 마이그 디렉토리 누락.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = 'prisma/migrations';
const ALLOWLIST = '.claude/state/migration-concurrently-allowlist.txt';
const RX = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi;

if (!existsSync(MIG_DIR) || !statSync(MIG_DIR).isDirectory()) {
  console.error(`[check:migrations] ${MIG_DIR} 디렉토리 없음.`);
  process.exit(2);
}

const allow = new Set(
  existsSync(ALLOWLIST)
    ? readFileSync(ALLOWLIST, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : [],
);

// 코멘트를 제거하되 원본 라인 번호 보존을 위해 같은 문자수(공백)로 치환.
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

let violations = 0;
for (const sub of readdirSync(MIG_DIR, { withFileTypes: true })) {
  if (!sub.isDirectory()) continue;
  const path = join(MIG_DIR, sub.name, 'migration.sql');
  if (!existsSync(path)) continue;
  if (allow.has(path)) continue;
  const raw = readFileSync(path, 'utf8');
  const stripped = stripSqlComments(raw);
  RX.lastIndex = 0;
  let m;
  while ((m = RX.exec(stripped)) !== null) {
    const lineNo = stripped.slice(0, m.index).split('\n').length;
    console.error(`${path}:${lineNo}: ${m[0]}`);
    violations++;
  }
}

if (violations > 0) {
  console.error(
    `\n[check:migrations] 신규 CONCURRENTLY ${violations}건 감지 — L-029 위반.\n` +
      `Prisma migrate deploy의 트랜잭션 wrap으로 운영 첫 배포 시 실패합니다.\n` +
      `대안: 일반 CREATE INDEX 또는 별도 runbook + IF NOT EXISTS no-op.\n` +
      `(database.md §"Prisma migrate deploy의 트랜잭션 wrap — CONCURRENTLY 금지" 참조)`,
  );
  process.exit(1);
}
console.log('[check:migrations] OK — no new CONCURRENTLY in migrations.');
