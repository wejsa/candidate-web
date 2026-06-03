import { VirusScanStatus } from '@prisma/client';
import { getEnv } from '@/lib/env';
import type { BatchDb } from '@/lib/batch/types';
import type { VirusScanner } from '@/lib/files/scanner';
import type { DeleteObjectFn } from '@/lib/batch/draft-retention';

// CANDID-029 Step 3 — PENDING 첨부 바이러스 스캔 처리 + INFECTED 자동삭제/알림 (BR-FILE-04).
//
// PENDING resume_files를 cursor(id) 페이지네이션으로 픽업(idx_resume_files_scan_pending) →
// 주입된 scanner로 판정 → 상태 갱신. INFECTED는 악성 파일(S3 객체) 삭제 + row를 INFECTED로 보존
// (audit — resume.ts/partial UNIQUE 정합) + owner 알림(BR-TX-02 fire-and-forget). 외부 효과
// (스캔/S3/메일)는 모두 DI라 테스트가 결정적이고, tsx CLI에서도 server-only 모듈을 거치지 않는다.

/** INFECTED 알림 발송기(주입). 평문 email/name + 원본 파일명. */
export type NotifyInfectedFn = (ctx: {
  to: string;
  name: string;
  filename: string;
}) => Promise<void>;

export interface VirusScanDeps {
  scanner: VirusScanner;
  deleteObject: DeleteObjectFn;
  notifyInfected: NotifyInfectedFn;
}

async function handleInfected(
  db: BatchDb,
  deps: VirusScanDeps,
  file: { id: number; storedPath: string; originalFilename: string; ownerUserId: number },
  now: Date,
): Promise<void> {
  const owner = await db.user.findUnique({
    where: { id: file.ownerUserId },
    select: { email: true, name: true },
  });
  // 악성 파일(S3 객체)을 삭제 — best-effort. 단, **row는 INFECTED로 보존**한다:
  //   - resume.ts D-MAJOR-2 정합("INFECTED/FAILED row는 audit 추적 위해 보존")
  //   - partial UNIQUE(uk_resume_files_one_per_*)가 PENDING/CLEAN만 평가하므로 INFECTED row는
  //     draft/application 슬롯을 막지 않음 → 재업로드 가능 + 감염 이력은 남는다.
  try {
    await deps.deleteObject(file.storedPath);
  } catch {
    /* non-fatal */
  }
  await db.resumeFile.update({
    where: { id: file.id },
    data: { virusScanStatus: VirusScanStatus.INFECTED, scannedAt: now },
  });
  if (owner !== null) {
    // 알림 실패는 비치명적(BR-TX-02 fire-and-forget) — 삭제는 이미 완료.
    try {
      await deps.notifyInfected({
        to: owner.email,
        name: owner.name,
        filename: file.originalFilename,
      });
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * PENDING 첨부를 스캔 처리한다. 반환값은 상태가 바뀐(CLEAN/FAILED/INFECTED) 파일 수.
 * SKIPPED(스캐너 비활성)는 PENDING을 유지하므로 카운트하지 않는다(다음 실행이 재시도).
 */
export async function processPendingScans(
  db: BatchDb,
  deps: VirusScanDeps,
  now: Date = new Date(),
  chunkSize: number = getEnv().BATCH_DELETE_CHUNK,
): Promise<number> {
  let cursor = 0;
  let processed = 0;

  for (;;) {
    const files = await db.resumeFile.findMany({
      where: { virusScanStatus: VirusScanStatus.PENDING, id: { gt: cursor } },
      select: { id: true, storedPath: true, originalFilename: true, ownerUserId: true },
      take: chunkSize,
      orderBy: { id: 'asc' },
    });
    if (files.length === 0) break;
    cursor = files[files.length - 1]?.id ?? cursor;

    for (const file of files) {
      const verdict = await deps.scanner.scan({ storedPath: file.storedPath });
      if (verdict === 'SKIPPED') continue; // 미검사 — PENDING 유지

      if (verdict === 'INFECTED') {
        await handleInfected(db, deps, file, now);
      } else {
        // CLEAN | FAILED
        await db.resumeFile.update({
          where: { id: file.id },
          data: { virusScanStatus: VirusScanStatus[verdict], scannedAt: now },
        });
      }
      processed += 1;
    }

    if (files.length < chunkSize) break;
  }

  return processed;
}
