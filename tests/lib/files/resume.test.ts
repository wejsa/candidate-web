import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { VirusScanStatus } from '@prisma/client';
import { AppError } from '@/lib/errors';

// CANDID-016 Step 2 — issueResumePresign 단위 테스트.
// Prisma + storage 둘 다 mock — 비즈니스 흐름(검증 → 소유권 → 정리 → presign)만 검증.

vi.mock('@/lib/prisma', () => ({
  basePrisma: {
    applicationDraft: { findUnique: vi.fn() },
    resumeFile: { findMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/files/storage', () => ({
  presignResumeUpload: vi.fn(),
  deleteResumeObject: vi.fn(),
  isValidResumeStoredPath: vi.fn().mockReturnValue(true),
}));

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    applicationDraft: { findUnique: Mock };
    resumeFile: { findMany: Mock; deleteMany: Mock };
    $transaction: Mock;
  };
};
const storage = (await import('@/lib/files/storage')) as unknown as {
  presignResumeUpload: Mock;
  deleteResumeObject: Mock;
};
const { issueResumePresign } = await import('@/lib/files/resume');

const baseRequest = {
  draftId: 7,
  originalFilename: 'CV.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
};

beforeEach(() => {
  basePrisma.applicationDraft.findUnique.mockReset();
  basePrisma.resumeFile.findMany.mockReset();
  basePrisma.resumeFile.deleteMany.mockReset();
  basePrisma.$transaction.mockReset();
  storage.presignResumeUpload.mockReset();
  storage.deleteResumeObject.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// $transaction 콜백 헬퍼 — tx 자리에 mock 객체 주입.
function stubTransaction(activeRows: Array<{ id: number; storedPath: string }>): void {
  basePrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      resumeFile: {
        findMany: vi.fn().mockResolvedValue(activeRows),
        deleteMany: vi.fn().mockResolvedValue({ count: activeRows.length }),
      },
    };
    return cb(tx);
  });
}

describe('issueResumePresign — 정상 흐름', () => {
  it('첫 업로드 — 활성 row 0 + presign 호출 + replacedPaths 빈 배열', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    stubTransaction([]);
    storage.presignResumeUpload.mockResolvedValue({
      uploadUrl: 'https://x',
      storedPath: 'resumes/2026/05/uuid.pdf',
      headers: { 'Content-Type': 'application/pdf' },
      expiresAt: new Date('2026-05-25T00:05:00Z'),
    });

    const result = await issueResumePresign({ userId: 42, request: baseRequest });

    expect(result.uploadUrl).toBe('https://x');
    expect(result.replacedPaths).toEqual([]);
    expect(storage.deleteResumeObject).not.toHaveBeenCalled();
    expect(storage.presignResumeUpload).toHaveBeenCalledWith('CV.pdf', 'application/pdf');
  });

  it('교체 — 기존 활성 row 1건 → deleteMany + fire-and-forget deleteResumeObject', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    stubTransaction([{ id: 99, storedPath: 'resumes/2026/05/old.pdf' }]);
    storage.presignResumeUpload.mockResolvedValue({
      uploadUrl: 'https://x',
      storedPath: 'resumes/2026/05/new.pdf',
      headers: { 'Content-Type': 'application/pdf' },
      expiresAt: new Date(),
    });
    storage.deleteResumeObject.mockResolvedValue(undefined);

    const result = await issueResumePresign({ userId: 42, request: baseRequest });

    expect(result.replacedPaths).toEqual(['resumes/2026/05/old.pdf']);
    // fire-and-forget이라 await 없이 호출 — 마이크로태스크 flush 후 확인.
    await Promise.resolve();
    expect(storage.deleteResumeObject).toHaveBeenCalledWith('resumes/2026/05/old.pdf');
  });

  it('S3 객체 삭제 실패는 무시 (silent) — 사용자 흐름 차단 안 함', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    stubTransaction([{ id: 99, storedPath: 'resumes/2026/05/old.pdf' }]);
    storage.presignResumeUpload.mockResolvedValue({
      uploadUrl: 'https://x',
      storedPath: 'resumes/2026/05/new.pdf',
      headers: { 'Content-Type': 'application/pdf' },
      expiresAt: new Date(),
    });
    storage.deleteResumeObject.mockRejectedValue(new Error('S3 unreachable'));

    await expect(issueResumePresign({ userId: 42, request: baseRequest })).resolves.toMatchObject({
      uploadUrl: 'https://x',
    });
  });
});

describe('issueResumePresign — 거부', () => {
  it('draft 미존재 → AUTH_FORBIDDEN', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue(null);
    await expect(issueResumePresign({ userId: 42, request: baseRequest })).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(storage.presignResumeUpload).not.toHaveBeenCalled();
  });

  it('타 사용자 draft → AUTH_FORBIDDEN', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 99 });
    await expect(issueResumePresign({ userId: 42, request: baseRequest })).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('validation 실패(잘못된 MIME) — storage 호출 안 함', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    await expect(
      issueResumePresign({
        userId: 42,
        request: { ...baseRequest, contentType: 'image/jpeg' },
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(storage.presignResumeUpload).not.toHaveBeenCalled();
  });
});

// VirusScanStatus enum 사용 확인 — 본 모듈이 D-MAJOR-2 정책과 정합.
describe('issueResumePresign — D-MAJOR-2 정책 정합', () => {
  it('deleteMany 호출 시 PENDING/CLEAN만 정리 (INFECTED 보존)', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    let capturedTxFindArgs: { where: { virusScanStatus?: unknown } } | undefined;
    basePrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        resumeFile: {
          findMany: vi.fn().mockImplementation((args: { where: { virusScanStatus?: unknown } }) => {
            capturedTxFindArgs = args;
            return Promise.resolve([]);
          }),
          deleteMany: vi.fn(),
        },
      };
      return cb(tx);
    });
    storage.presignResumeUpload.mockResolvedValue({
      uploadUrl: 'x',
      storedPath: 'resumes/2026/05/x.pdf',
      headers: { 'Content-Type': 'application/pdf' },
      expiresAt: new Date(),
    });

    await issueResumePresign({ userId: 42, request: baseRequest });

    expect(capturedTxFindArgs?.where.virusScanStatus).toEqual({
      in: [VirusScanStatus.PENDING, VirusScanStatus.CLEAN],
    });
  });
});
