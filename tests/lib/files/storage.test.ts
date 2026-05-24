import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factory는 hoisting되므로 외부 변수 참조 불가 — vi.hoisted로 모킹용 fn 사전 끌어올림.
const { getSignedUrlMock, s3SendMock } = vi.hoisted(() => ({
  getSignedUrlMock: vi.fn(),
  s3SendMock: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

vi.mock('@aws-sdk/client-s3', async () => {
  // S3ServiceException 동일 클래스를 재현 — instanceof 검사 통과용 (deleteResumeObject NoSuchKey 분기).
  class S3ServiceException extends Error {
    declare readonly $metadata: { httpStatusCode?: number };
    declare readonly $fault: 'client' | 'server';
    constructor(opts: { name: string; message: string; $metadata?: object; $fault?: string }) {
      super(opts.message);
      this.name = opts.name;
      Object.defineProperty(this, '$metadata', { value: opts.$metadata ?? {} });
      Object.defineProperty(this, '$fault', { value: opts.$fault ?? 'client' });
    }
  }
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class S3Client {
    constructor(public config: Record<string, unknown>) {}
    send = s3SendMock;
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, S3ServiceException };
});

import { S3ServiceException } from '@aws-sdk/client-s3';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { AppError } from '@/lib/errors';
import {
  __resetStorageClientForTesting,
  buildResumeKey,
  deleteResumeObject,
  isValidResumeStoredPath,
  presignResumeUpload,
} from '@/lib/files/storage';

function stubS3Env(): void {
  vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
  vi.stubEnv('S3_BUCKET', 'candidate-web-resumes');
  vi.stubEnv('S3_ACCESS_KEY', 'candidate');
  vi.stubEnv('S3_SECRET_KEY', 'candidate-dev-secret');
}

beforeEach(() => {
  getSignedUrlMock.mockReset();
  s3SendMock.mockReset();
  __resetCachedEnvForTesting();
  __resetStorageClientForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetStorageClientForTesting();
});

describe('buildResumeKey', () => {
  const fixed = new Date(Date.UTC(2026, 4, 24, 10, 30, 0)); // 2026-05-24

  it('확장자 보존 + UTC 기준 YYYY/MM 경로', () => {
    const key = buildResumeKey('이력서.pdf', fixed);
    expect(key).toMatch(
      /^resumes\/2026\/05\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
    );
  });

  it('대문자 확장자는 소문자화', () => {
    const key = buildResumeKey('Resume.PDF', fixed);
    expect(key).toMatch(/\.pdf$/);
  });

  it('확장자 없음/특수문자/5자 초과는 bin 폴백 — 경로 traversal 차단', () => {
    expect(buildResumeKey('noext', fixed)).toMatch(/\.bin$/);
    expect(buildResumeKey('../etc/passwd', fixed)).toMatch(/\.bin$/);
    // 9자 확장자는 화이트리스트 정규식(1~5자) 초과 → bin 폴백.
    expect(buildResumeKey('shell.exe.malicious', fixed)).toMatch(/\.bin$/);
    // 점이 여러 개 — 마지막 확장자(5자 이하 + 영숫자)만 보존.
    expect(buildResumeKey('report.v1.docx', fixed)).toMatch(/\.docx$/);
  });

  it('두 번 호출 시 서로 다른 UUID', () => {
    const a = buildResumeKey('x.pdf', fixed);
    const b = buildResumeKey('x.pdf', fixed);
    expect(a).not.toBe(b);
  });
});

describe('isValidResumeStoredPath', () => {
  it('정상 키 통과', () => {
    expect(
      isValidResumeStoredPath('resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.pdf'),
    ).toBe(true);
  });

  it.each([
    ['외부 prefix', '../etc/passwd'],
    ['잘못된 prefix', 'avatars/2026/05/01234567-89ab-cdef-0123-456789abcdef.pdf'],
    ['월 2자리 불만족', 'resumes/2026/5/01234567-89ab-cdef-0123-456789abcdef.pdf'],
    ['UUID 형식 위반', 'resumes/2026/05/not-a-uuid.pdf'],
    ['확장자 누락', 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef'],
    ['빈 문자열', ''],
  ])('%s 거부: %s', (_label, input) => {
    expect(isValidResumeStoredPath(input)).toBe(false);
  });
});

describe('presignResumeUpload', () => {
  it('S3 미구성 시 FILE_UPLOAD_FAILED throw', async () => {
    await expect(presignResumeUpload('a.pdf', 'application/pdf')).rejects.toMatchObject({
      code: 'FILE_UPLOAD_FAILED',
    });
  });

  it('성공 시 uploadUrl/storedPath/headers/expiresAt 반환', async () => {
    stubS3Env();
    getSignedUrlMock.mockResolvedValue('https://minio.local/upload?sig=abc');
    const now = new Date(Date.UTC(2026, 4, 24, 10, 30, 0));

    const result = await presignResumeUpload('이력서.pdf', 'application/pdf', now);

    expect(result.uploadUrl).toBe('https://minio.local/upload?sig=abc');
    expect(result.storedPath).toMatch(/^resumes\/2026\/05\/.+\.pdf$/);
    expect(result.headers).toEqual({ 'Content-Type': 'application/pdf' });
    // 기본 TTL 300초.
    expect(result.expiresAt.getTime() - now.getTime()).toBe(300_000);
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
  });

  it('getSignedUrl throw → AppError FILE_UPLOAD_FAILED로 래핑', async () => {
    stubS3Env();
    getSignedUrlMock.mockRejectedValue(new Error('AWS region not set'));
    await expect(presignResumeUpload('a.pdf', 'application/pdf')).rejects.toBeInstanceOf(AppError);
    await expect(presignResumeUpload('a.pdf', 'application/pdf')).rejects.toMatchObject({
      code: 'FILE_UPLOAD_FAILED',
    });
  });
});

describe('deleteResumeObject', () => {
  const validPath = 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.pdf';

  it('잘못된 storedPath 거부 — S3 호출 안 함', async () => {
    stubS3Env();
    await expect(deleteResumeObject('../etc/passwd')).rejects.toMatchObject({
      code: 'FILE_UPLOAD_FAILED',
    });
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it('정상 삭제', async () => {
    stubS3Env();
    s3SendMock.mockResolvedValue({});
    await expect(deleteResumeObject(validPath)).resolves.toBeUndefined();
    expect(s3SendMock).toHaveBeenCalledTimes(1);
  });

  it('NoSuchKey는 멱등 성공', async () => {
    stubS3Env();
    s3SendMock.mockRejectedValue(
      new S3ServiceException({
        name: 'NoSuchKey',
        message: 'not found',
        $fault: 'client',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(deleteResumeObject(validPath)).resolves.toBeUndefined();
  });

  it('다른 S3 에러는 FILE_UPLOAD_FAILED로 래핑', async () => {
    stubS3Env();
    s3SendMock.mockRejectedValue(
      new S3ServiceException({
        name: 'AccessDenied',
        message: 'forbidden',
        $fault: 'client',
        $metadata: { httpStatusCode: 403 },
      }),
    );
    await expect(deleteResumeObject(validPath)).rejects.toMatchObject({
      code: 'FILE_UPLOAD_FAILED',
    });
  });
});
