import { Prisma } from '@prisma/client';

// CANDID-016 Step 2 PR #58 in-PR fix (A-MAJOR-1 + D-MAJOR-1 + S-MAJOR-1):
//
// A-MAJOR-1 — 순환 import 방지: resume.ts/confirm.ts 양쪽이 본 모듈만 import (동등 계층 결합 해소).
// D-MAJOR-1/S-MAJOR-1 — P2002 target 검증: 모든 P2002를 FILE_ALREADY_EXISTS로 매핑하면 향후
//   `checksum_sha256 UNIQUE` 등 추가 시 잘못된 안내 발생. 본 헬퍼는 *resume_files 활성 첨부 UNIQUE
//   인덱스 충돌만* 식별 — target=['draft_id'] 또는 ['application_id']인 경우에만 true.

// 본 두 인덱스가 partial UNIQUE 활성 첨부 강제. 다른 P2002는 전파.
const RESUME_ACTIVE_UNIQUE_COLUMNS = new Set(['draft_id', 'application_id']);

/**
 * P2002 충돌이 resume_files 활성 첨부 partial UNIQUE에 의한 것인지 식별.
 * `err.meta.target`은 Prisma 버전에 따라 string 또는 string[] — 양쪽 처리.
 */
export function isResumeActiveUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const raw = err.meta?.target;
  const targets: string[] = Array.isArray(raw)
    ? (raw as string[])
    : typeof raw === 'string'
      ? [raw]
      : [];
  return targets.some((t) => RESUME_ACTIVE_UNIQUE_COLUMNS.has(t));
}
