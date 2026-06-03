import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { cleanupStaleDrafts } from '@/lib/batch/draft-retention';

// CANDID-029 Step 2 — 30일 미제출 Draft 정리 단위 테스트.
// 핵심 보장: orphan-safe 순서(S3 선삭제 → row 삭제 → draft 삭제), S3 실패 시 draft 보존(skip),
// cursor 페이지네이션, 트랜잭션 경계.

type DraftMock = { findMany: Mock; delete: Mock };
type ResumeMock = { findMany: Mock; deleteMany: Mock };

function makeDb(): {
  db: PrismaClient;
  applicationDraft: DraftMock;
  resumeFile: ResumeMock;
  tx: { resumeFile: ResumeMock; applicationDraft: DraftMock };
  transaction: Mock;
} {
  const applicationDraft = { findMany: vi.fn(), delete: vi.fn() };
  const resumeFile = { findMany: vi.fn(), deleteMany: vi.fn() };
  // 트랜잭션 콜백에 주입되는 tx 핸들 — 별도 mock으로 호출 순서/인자 검증.
  const tx = {
    resumeFile: { findMany: vi.fn(), deleteMany: vi.fn() },
    applicationDraft: { findMany: vi.fn(), delete: vi.fn() },
  };
  const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const db = {
    applicationDraft,
    resumeFile,
    $transaction: transaction,
  } as unknown as PrismaClient;
  return { db, applicationDraft, resumeFile, tx, transaction };
}

const NOW = new Date('2026-06-03T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cleanupStaleDrafts', () => {
  it('대상 draft가 없으면 0 반환(S3/tx 미호출)', async () => {
    const { db, applicationDraft, transaction } = makeDb();
    applicationDraft.findMany.mockResolvedValueOnce([]);
    const deleteObject = vi.fn();

    const n = await cleanupStaleDrafts(db, deleteObject, NOW);

    expect(n).toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lastSavedAt < cutoff(30일) + id 커서로 조회한다', async () => {
    const { db, applicationDraft, resumeFile } = makeDb();
    applicationDraft.findMany.mockResolvedValueOnce([]);
    await cleanupStaleDrafts(db, vi.fn(), NOW, 1000);

    const cutoff = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(applicationDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lastSavedAt: { lt: cutoff }, id: { gt: 0 } },
        take: 1000,
        orderBy: { id: 'asc' },
      }),
    );
    void resumeFile;
  });

  it('첨부 있는 draft — S3 선삭제 → resume_files 삭제 → draft 삭제 순서를 지킨다', async () => {
    const { db, applicationDraft, resumeFile, tx, transaction } = makeDb();
    applicationDraft.findMany.mockResolvedValueOnce([{ id: 5 }]).mockResolvedValueOnce([]); // 다음 커서 조회는 빈 결과
    resumeFile.findMany.mockResolvedValueOnce([
      { id: 11, storedPath: 'resumes/2026/05/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf' },
    ]);
    const order: string[] = [];
    const deleteObject = vi.fn(async (p: string) => {
      order.push(`s3:${p}`);
    });
    tx.resumeFile.deleteMany.mockImplementation(async () => {
      order.push('rows');
      return { count: 1 };
    });
    tx.applicationDraft.delete.mockImplementation(async () => {
      order.push('draft');
      return {};
    });

    const n = await cleanupStaleDrafts(db, deleteObject, NOW, 1); // chunkSize=1

    expect(n).toBe(1);
    // S3 삭제가 트랜잭션보다 먼저 — orphan-safe 순서.
    expect(order).toEqual([
      's3:resumes/2026/05/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf',
      'rows',
      'draft',
    ]);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.resumeFile.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [11] } } });
    expect(tx.applicationDraft.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('첨부 없는 draft — S3 호출 없이 트랜잭션으로 draft만 삭제', async () => {
    const { db, applicationDraft, resumeFile, tx } = makeDb();
    applicationDraft.findMany.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]);
    resumeFile.findMany.mockResolvedValueOnce([]);
    const deleteObject = vi.fn();

    const n = await cleanupStaleDrafts(db, deleteObject, NOW, 1);

    expect(n).toBe(1);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(tx.resumeFile.deleteMany).not.toHaveBeenCalled(); // 파일 없으면 row 삭제 생략
    expect(tx.applicationDraft.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('S3 삭제 실패 시 해당 draft는 보존(skip) — row/draft 미삭제(orphan 방지)', async () => {
    const { db, applicationDraft, resumeFile, transaction } = makeDb();
    applicationDraft.findMany.mockResolvedValueOnce([{ id: 9 }]).mockResolvedValueOnce([]);
    resumeFile.findMany.mockResolvedValueOnce([
      { id: 21, storedPath: 'resumes/2026/05/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf' },
    ]);
    const deleteObject = vi.fn().mockRejectedValue(new Error('s3 down'));

    const n = await cleanupStaleDrafts(db, deleteObject, NOW, 1);

    expect(n).toBe(0); // 삭제된 draft 없음
    expect(transaction).not.toHaveBeenCalled(); // 트랜잭션 진입 안 함 → row/draft 보존
  });

  it('한 draft의 여러 파일 중 일부 S3 삭제 후 실패하면 draft 보존(tx 미진입)', async () => {
    const { db, applicationDraft, resumeFile, transaction } = makeDb();
    applicationDraft.findMany.mockResolvedValueOnce([{ id: 5 }]).mockResolvedValueOnce([]);
    resumeFile.findMany.mockResolvedValueOnce([
      { id: 11, storedPath: 'resumes/2026/05/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf' },
      { id: 12, storedPath: 'resumes/2026/05/ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.pdf' },
    ]);
    // 첫 파일 성공, 둘째 실패 → s3Ok=false. (이미 삭제된 첫 파일은 다음 배치에서 NoSuchKey 멱등.)
    const deleteObject = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('s3 timeout'));

    const n = await cleanupStaleDrafts(db, deleteObject, NOW, 1);

    expect(n).toBe(0);
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(transaction).not.toHaveBeenCalled(); // row/draft 보존 → orphan 방지
  });

  it('같은 청크에 성공/실패 draft 혼재 — 성공분만 삭제·카운트, cursor는 청크 끝까지 전진', async () => {
    const { db, applicationDraft, resumeFile, tx, transaction } = makeDb();
    applicationDraft.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // A(id=1, 첨부 없음), B(id=2, S3 실패)
      .mockResolvedValueOnce([]);
    resumeFile.findMany
      .mockResolvedValueOnce([]) // A: 첨부 없음 → 성공 삭제
      .mockResolvedValueOnce([
        { id: 21, storedPath: 'resumes/2026/05/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf' },
      ]); // B: 첨부 있음, S3 실패
    const deleteObject = vi.fn().mockRejectedValue(new Error('s3 down'));

    const n = await cleanupStaleDrafts(db, deleteObject, NOW, 2);

    expect(n).toBe(1); // A만 삭제
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.applicationDraft.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    // 실패한 B(id=2)도 포함해 cursor가 청크 끝(2)까지 전진 → 다음 조회는 id>2.
    expect(applicationDraft.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { gt: 2 } }) }),
    );
  });

  it('cursor 페이지네이션 — chunk를 가득 채우면 마지막 id 이후로 이어 조회한다', async () => {
    const { db, applicationDraft, resumeFile } = makeDb();
    applicationDraft.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // 가득 찬 청크
      .mockResolvedValueOnce([{ id: 3 }]); // 다음 청크(미만) → 종료
    resumeFile.findMany.mockResolvedValue([]); // 모든 draft 첨부 없음

    const n = await cleanupStaleDrafts(db, vi.fn(), NOW, 2);

    expect(n).toBe(3);
    expect(applicationDraft.findMany).toHaveBeenCalledTimes(2);
    // 2번째 조회 커서가 1번째 청크 마지막 id(2) 이후.
    expect(applicationDraft.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { gt: 2 } }) }),
    );
  });
});
