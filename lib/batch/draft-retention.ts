import { getEnv } from '@/lib/env';
import type { BatchDb } from '@/lib/batch/types';

// CANDID-029 Step 2 — 30일 미제출 Draft + 첨부 파일 정리 (BR-FILE-06).
//
// orphan-safe 순서(db-designer MAJOR): `resume_files.draft_id`는 ON DELETE SET NULL이라
// Draft만 삭제하면 파일 row가 draft_id=NULL orphan으로 남고 S3 객체도 잔존한다(BR-FILE-06 위반).
// 따라서 draft별로 다음 순서를 지킨다:
//   (1) S3 객체 삭제   — 트랜잭션 *외부*(BR-TX-02 외부 호출 격리)
//   (2) resume_files row 삭제 → (3) draft 삭제(portfolio_links는 CASCADE) — 단일 트랜잭션
// S3 삭제가 하나라도 실패하면 해당 draft는 **건너뛴다**(row/draft 보존) → 다음 배치가 재시도(멱등).
//
// 페이지네이션은 cursor(id) 기반 — 삭제로 진행을 보장하는 offset 방식과 달리, S3 실패로 보존된
// draft를 같은 실행 안에서 반복 재처리하지 않도록 한다(실패분은 다음 야간 실행이 재시도).

const MS_PER_DAY = 86_400_000;

/** S3 객체 삭제기(주입). lib/batch/storage.ts의 deleteBatchObject 또는 테스트 mock. */
export type DeleteObjectFn = (storedPath: string) => Promise<void>;

export async function cleanupStaleDrafts(
  db: BatchDb,
  deleteObject: DeleteObjectFn,
  now: Date = new Date(),
  chunkSize: number = getEnv().BATCH_DELETE_CHUNK,
): Promise<number> {
  const cutoff = new Date(now.getTime() - getEnv().DRAFT_RETENTION_DAYS * MS_PER_DAY);
  let deletedDrafts = 0;
  let cursor = 0;

  for (;;) {
    const drafts = await db.applicationDraft.findMany({
      where: { lastSavedAt: { lt: cutoff }, id: { gt: cursor } },
      select: { id: true },
      take: chunkSize,
      orderBy: { id: 'asc' },
    });
    if (drafts.length === 0) break;
    cursor = drafts[drafts.length - 1]?.id ?? cursor; // 실패로 보존된 draft도 건너뛰도록 단조 전진

    for (const draft of drafts) {
      const files = await db.resumeFile.findMany({
        where: { draftId: draft.id },
        select: { id: true, storedPath: true },
      });

      // (1) S3 객체 선삭제 — 트랜잭션 외부. 하나라도 실패하면 draft 보존(orphan 방지) → 재시도.
      let s3Ok = true;
      for (const file of files) {
        try {
          await deleteObject(file.storedPath);
        } catch {
          s3Ok = false;
          break;
        }
      }
      if (!s3Ok) continue;

      // (2)(3) resume_files row 삭제 → draft 삭제(portfolio_links CASCADE) — 단일 트랜잭션.
      await db.$transaction(async (tx) => {
        if (files.length > 0) {
          await tx.resumeFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
        }
        await tx.applicationDraft.delete({ where: { id: draft.id } });
      });
      deletedDrafts += 1;
    }

    if (drafts.length < chunkSize) break;
  }

  return deletedDrafts;
}
