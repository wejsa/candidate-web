import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma, VirusScanStatus } from '@prisma/client';
import { AppError } from '@/lib/errors';

// CANDID-016 Step 2 — confirmResumeUpload 단위 테스트.

vi.mock('@/lib/prisma', () => ({
  basePrisma: {
    applicationDraft: { findUnique: vi.fn() },
    resumeFile: { create: vi.fn() },
  },
}));

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    applicationDraft: { findUnique: Mock };
    resumeFile: { create: Mock };
  };
};
const { confirmResumeUpload } = await import('@/lib/files/confirm');

const validRequest = {
  draftId: 7,
  storedPath: 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.pdf',
  originalFilename: 'CV.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  checksumSha256: '0'.repeat(64),
};

function fakeP2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

beforeEach(() => {
  basePrisma.applicationDraft.findUnique.mockReset();
  basePrisma.resumeFile.create.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('confirmResumeUpload — 정상', () => {
  it('create 성공 + virusScanStatus PENDING 반환', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    const uploadedAt = new Date('2026-05-25T00:10:00Z');
    basePrisma.resumeFile.create.mockResolvedValue({
      id: 99,
      virusScanStatus: VirusScanStatus.PENDING,
      uploadedAt,
    });

    const result = await confirmResumeUpload({ userId: 42, request: validRequest });

    expect(result).toEqual({
      id: 99,
      virusScanStatus: VirusScanStatus.PENDING,
      uploadedAt,
    });
    // fileSize는 BigInt로 변환되어 저장.
    expect(basePrisma.resumeFile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerUserId: 42,
          draftId: 7,
          fileSize: BigInt(1024),
        }),
      }),
    );
  });
});

describe('confirmResumeUpload — 거부', () => {
  it('storedPath 형식 위변조 → SYS_VALIDATION_FAILED', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    await expect(
      confirmResumeUpload({
        userId: 42,
        request: { ...validRequest, storedPath: '../etc/passwd' },
      }),
    ).rejects.toMatchObject({ code: 'SYS_VALIDATION_FAILED' });
    expect(basePrisma.resumeFile.create).not.toHaveBeenCalled();
  });

  it('draft 미존재 → AUTH_FORBIDDEN', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue(null);
    await expect(confirmResumeUpload({ userId: 42, request: validRequest })).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(basePrisma.resumeFile.create).not.toHaveBeenCalled();
  });

  it('타 사용자 draft → AUTH_FORBIDDEN', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 99 });
    await expect(confirmResumeUpload({ userId: 42, request: validRequest })).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('P2002(partial UNIQUE 충돌) → FILE_ALREADY_EXISTS', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    basePrisma.resumeFile.create.mockRejectedValue(fakeP2002(['draft_id']));

    await expect(confirmResumeUpload({ userId: 42, request: validRequest })).rejects.toMatchObject({
      code: 'FILE_ALREADY_EXISTS',
    });
  });

  it('P2002 외 Prisma 에러는 그대로 전파', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    const other = new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
      code: 'P2003',
      clientVersion: 'test',
    });
    basePrisma.resumeFile.create.mockRejectedValue(other);

    await expect(confirmResumeUpload({ userId: 42, request: validRequest })).rejects.toBe(other);
  });

  it('validation 실패(파일명 경로 문자) — DB 호출 안 함', async () => {
    basePrisma.applicationDraft.findUnique.mockResolvedValue({ id: 7, userId: 42 });
    await expect(
      confirmResumeUpload({
        userId: 42,
        request: { ...validRequest, originalFilename: 'sub/file.pdf' },
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(basePrisma.resumeFile.create).not.toHaveBeenCalled();
  });
});
