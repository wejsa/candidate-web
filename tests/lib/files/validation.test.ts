import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  assertResumeContentType,
  assertResumeFileSize,
  ConfirmRequestSchema,
  PresignRequestSchema,
  RESUME_MAX_BYTES,
} from '@/lib/files/validation';

// CANDID-016 Step 2 — 화이트리스트 + 경로 문자 + MIME 정합 + 크기 가드 (BR-FILE-01~03).

describe('assertResumeContentType — 정상 화이트리스트', () => {
  it.each([
    ['CV.pdf', 'application/pdf', 'pdf'],
    [
      'resume.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'docx',
    ],
    ['file.doc', 'application/msword', 'doc'],
    ['이력서.hwp', 'application/x-hwp', 'hwp'],
    ['이력서.hwpx', 'application/hwp+zip', 'hwpx'],
    // 대문자 확장자 + 대문자 MIME — case-insensitive 통과
    ['CV.PDF', 'APPLICATION/PDF', 'pdf'],
  ])('통과: %s + %s → ext=%s', (filename, mime, expected) => {
    expect(assertResumeContentType(filename, mime)).toBe(expected);
  });
});

describe('assertResumeContentType — 거부', () => {
  it.each([
    ['확장자 없음', 'noext', 'application/pdf', 'FILE_TYPE_NOT_ALLOWED'],
    ['미허용 확장자', 'malware.exe', 'application/x-msdownload', 'FILE_TYPE_NOT_ALLOWED'],
    ['MIME 불일치', 'CV.pdf', 'image/jpeg', 'FILE_TYPE_NOT_ALLOWED'],
    ['MIME 불일치 (확장자 docx + MIME pdf)', 'CV.docx', 'application/pdf', 'FILE_TYPE_NOT_ALLOWED'],
  ])('%s — %s + %s', (_label, filename, mime, expectedCode) => {
    try {
      assertResumeContentType(filename, mime);
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(expectedCode);
    }
  });

  it.each([
    ['경로 문자 /', 'sub/dir/file.pdf'],
    ['경로 문자 \\', 'sub\\dir\\file.pdf'],
    ['../ traversal', '../file.pdf'],
    ['빈 문자열', ''],
    ['NULL byte', 'file\x00.pdf'],
    ['control char', 'file\n.pdf'],
  ])('파일명 형식 거부 (%s) — %s', (_label, filename) => {
    try {
      assertResumeContentType(filename, 'application/pdf');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('SYS_VALIDATION_FAILED');
    }
  });

  it('UTF-8 255 byte 초과 거부', () => {
    // 한글 1자 = 3 byte → 86자 = 258 byte (255 초과). + .pdf
    const longName = '한'.repeat(86) + '.pdf';
    expect(() => assertResumeContentType(longName, 'application/pdf')).toThrow(AppError);
  });
});

describe('assertResumeFileSize', () => {
  it('정상 통과', () => {
    expect(() => assertResumeFileSize(1024)).not.toThrow();
    expect(() => assertResumeFileSize(RESUME_MAX_BYTES)).not.toThrow();
  });

  it.each([
    ['0', 0, 'SYS_VALIDATION_FAILED'],
    ['음수', -1, 'SYS_VALIDATION_FAILED'],
    ['소수', 1024.5, 'SYS_VALIDATION_FAILED'],
    ['10MB + 1', RESUME_MAX_BYTES + 1, 'FILE_SIZE_EXCEEDED'],
  ])('거부: %s → %s', (_label, size, code) => {
    try {
      assertResumeFileSize(size);
      expect.fail('should throw');
    } catch (e) {
      expect((e as AppError).code).toBe(code);
    }
  });
});

describe('PresignRequestSchema', () => {
  it('정상 통과', () => {
    expect(
      PresignRequestSchema.parse({
        draftId: 1,
        originalFilename: 'CV.pdf',
        contentType: 'application/pdf',
        fileSize: 1024,
      }),
    ).toEqual({
      draftId: 1,
      originalFilename: 'CV.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
    });
  });

  it.each<[Record<string, unknown>, string]>([
    [{ draftId: 0 }, 'draftId 0 거부'],
    [{ draftId: -1 }, '음수 draftId'],
    [{ originalFilename: '' }, '빈 filename'],
    [{ fileSize: 0 }, 'fileSize 0'],
  ])('파싱 실패: %o (%s)', (overrides) => {
    expect(() =>
      PresignRequestSchema.parse({
        draftId: 1,
        originalFilename: 'CV.pdf',
        contentType: 'application/pdf',
        fileSize: 1024,
        ...overrides,
      }),
    ).toThrow();
  });
});

describe('ConfirmRequestSchema', () => {
  const validBase = {
    draftId: 1,
    storedPath: 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.pdf',
    originalFilename: 'CV.pdf',
    contentType: 'application/pdf',
    fileSize: 1024,
    checksumSha256: '0'.repeat(64),
  };

  it('정상 통과', () => {
    expect(() => ConfirmRequestSchema.parse(validBase)).not.toThrow();
  });

  it('checksumSha256 형식 위반 — 63자', () => {
    expect(() => ConfirmRequestSchema.parse({ ...validBase, checksumSha256: '0'.repeat(63) })).toThrow();
  });

  it('checksumSha256 대문자 거부 (lowercase strict)', () => {
    expect(() => ConfirmRequestSchema.parse({ ...validBase, checksumSha256: 'A'.repeat(64) })).toThrow();
  });
});
