import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { processPendingScans, type VirusScanDeps } from '@/lib/batch/virus-scan';
import type { ScanVerdict } from '@/lib/files/scanner';

// CANDID-029 Step 3 — PENDING 스캔 처리 단위 테스트.
// scanner/deleteObject/notifyInfected를 DI mock으로 주입 → INFECTED 자동삭제/알림 경로 결정적 검증.

const NOW = new Date('2026-06-03T00:00:00.000Z');

function makeDb(): {
  db: PrismaClient;
  resumeFile: { findMany: Mock; update: Mock; delete: Mock };
  user: { findUnique: Mock };
} {
  const resumeFile = { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const user = { findUnique: vi.fn() };
  const db = { resumeFile, user } as unknown as PrismaClient;
  return { db, resumeFile, user };
}

function makeDeps(verdict: ScanVerdict): {
  deps: VirusScanDeps;
  scan: Mock;
  deleteObject: Mock;
  notifyInfected: Mock;
} {
  const scan = vi.fn().mockResolvedValue(verdict);
  const deleteObject = vi.fn().mockResolvedValue(undefined);
  const notifyInfected = vi.fn().mockResolvedValue(undefined);
  return {
    deps: { scanner: { scan }, deleteObject, notifyInfected },
    scan,
    deleteObject,
    notifyInfected,
  };
}

const PENDING_FILE = {
  id: 3,
  storedPath: 'resumes/2026/05/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf',
  originalFilename: 'malware.pdf',
  ownerUserId: 42,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processPendingScans', () => {
  it('PENDING 파일이 없으면 0 반환', async () => {
    const { db, resumeFile } = makeDb();
    resumeFile.findMany.mockResolvedValueOnce([]);
    const { deps } = makeDeps('CLEAN');

    expect(await processPendingScans(db, deps, NOW)).toBe(0);
    expect(resumeFile.update).not.toHaveBeenCalled();
  });

  it('SKIPPED 판정은 상태를 바꾸지 않는다(PENDING 유지)', async () => {
    const { db, resumeFile } = makeDb();
    resumeFile.findMany.mockResolvedValueOnce([PENDING_FILE]).mockResolvedValueOnce([]);
    const { deps, deleteObject } = makeDeps('SKIPPED');

    const n = await processPendingScans(db, deps, NOW, 1);

    expect(n).toBe(0);
    expect(resumeFile.update).not.toHaveBeenCalled();
    expect(resumeFile.delete).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('CLEAN 판정은 virus_scan_status=CLEAN + scannedAt 갱신', async () => {
    const { db, resumeFile } = makeDb();
    resumeFile.findMany.mockResolvedValueOnce([PENDING_FILE]).mockResolvedValueOnce([]);
    const { deps } = makeDeps('CLEAN');

    const n = await processPendingScans(db, deps, NOW, 1);

    expect(n).toBe(1);
    expect(resumeFile.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { virusScanStatus: 'CLEAN', scannedAt: NOW },
    });
  });

  it('FAILED 판정은 virus_scan_status=FAILED 갱신', async () => {
    const { db, resumeFile } = makeDb();
    resumeFile.findMany.mockResolvedValueOnce([PENDING_FILE]).mockResolvedValueOnce([]);
    const { deps } = makeDeps('FAILED');

    await processPendingScans(db, deps, NOW, 1);

    expect(resumeFile.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { virusScanStatus: 'FAILED', scannedAt: NOW },
    });
  });

  it('INFECTED — owner 조회 → S3 삭제 → row 삭제 → 알림 발송', async () => {
    const { db, resumeFile, user } = makeDb();
    resumeFile.findMany.mockResolvedValueOnce([PENDING_FILE]).mockResolvedValueOnce([]);
    user.findUnique.mockResolvedValueOnce({ email: 'owner@example.com', name: '홍길동' });
    const { deps, deleteObject, notifyInfected } = makeDeps('INFECTED');

    const n = await processPendingScans(db, deps, NOW, 1);

    expect(n).toBe(1);
    expect(deleteObject).toHaveBeenCalledWith(PENDING_FILE.storedPath);
    expect(resumeFile.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(notifyInfected).toHaveBeenCalledWith({
      to: 'owner@example.com',
      name: '홍길동',
      filename: 'malware.pdf',
    });
    expect(resumeFile.update).not.toHaveBeenCalled(); // 삭제 경로라 update 없음
  });

  it('INFECTED — S3 삭제 실패해도 row 삭제 + 알림은 진행(best-effort)', async () => {
    const { db, resumeFile, user } = makeDb();
    resumeFile.findMany.mockResolvedValueOnce([PENDING_FILE]).mockResolvedValueOnce([]);
    user.findUnique.mockResolvedValueOnce({ email: 'o@x.com', name: 'A' });
    const { deps, notifyInfected } = makeDeps('INFECTED');
    deps.deleteObject = vi.fn().mockRejectedValue(new Error('s3 down'));

    await processPendingScans(db, deps, NOW, 1);

    expect(resumeFile.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(notifyInfected).toHaveBeenCalledOnce();
  });

  it('INFECTED — owner가 없으면 알림 생략(삭제는 진행)', async () => {
    const { db, resumeFile, user } = makeDb();
    resumeFile.findMany.mockResolvedValueOnce([PENDING_FILE]).mockResolvedValueOnce([]);
    user.findUnique.mockResolvedValueOnce(null);
    const { deps, notifyInfected } = makeDeps('INFECTED');

    await processPendingScans(db, deps, NOW, 1);

    expect(resumeFile.delete).toHaveBeenCalled();
    expect(notifyInfected).not.toHaveBeenCalled();
  });

  it('INFECTED — 알림 실패는 비치명적(예외 전파 안 함)', async () => {
    const { db, resumeFile, user } = makeDb();
    resumeFile.findMany.mockResolvedValueOnce([PENDING_FILE]).mockResolvedValueOnce([]);
    user.findUnique.mockResolvedValueOnce({ email: 'o@x.com', name: 'A' });
    const { deps } = makeDeps('INFECTED');
    deps.notifyInfected = vi.fn().mockRejectedValue(new Error('smtp down'));

    await expect(processPendingScans(db, deps, NOW, 1)).resolves.toBe(1);
    expect(resumeFile.delete).toHaveBeenCalled();
  });

  it('cursor 페이지네이션 — chunk를 채우면 마지막 id 이후로 이어 조회', async () => {
    const { db, resumeFile } = makeDb();
    resumeFile.findMany
      .mockResolvedValueOnce([
        { ...PENDING_FILE, id: 1 },
        { ...PENDING_FILE, id: 2 },
      ])
      .mockResolvedValueOnce([{ ...PENDING_FILE, id: 3 }]);
    const { deps } = makeDeps('CLEAN');

    const n = await processPendingScans(db, deps, NOW, 2);

    expect(n).toBe(3);
    expect(resumeFile.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { gt: 2 } }) }),
    );
  });
});
