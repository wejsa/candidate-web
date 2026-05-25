#!/usr/bin/env node
// CANDID-038: prisma migration.sql에서 신규 `CREATE INDEX CONCURRENTLY` 검출 (L-029 회귀 차단).
//
// 정규식: 라인 주석(`-- ...`)을 시작 부분에서 제외하고 실제 DDL 문만 매칭.
//   `^[^-]*CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b`
// allowlist: `.claude/state/migration-concurrently-allowlist.txt` (한 줄당 파일 경로).
//
// Exit: 0 = clean, 1 = 신규 detection, 2 = 마이그 디렉토리 누락.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = 'prisma/migrations';
const ALLOWLIST = '.claude/state/migration-concurrently-allowlist.txt';
const RX = /^[^-]*\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i;

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

let violations = 0;
for (const sub of readdirSync(MIG_DIR, { withFileTypes: true })) {
  if (!sub.isDirectory()) continue;
  const path = join(MIG_DIR, sub.name, 'migration.sql');
  if (!existsSync(path)) continue;
  if (allow.has(path)) continue;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (RX.test(lines[i])) {
      console.error(`${path}:${i + 1}: ${lines[i].trim()}`);
      violations++;
    }
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
