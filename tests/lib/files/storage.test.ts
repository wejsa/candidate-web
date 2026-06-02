import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factory는 hoisting되므로 외부 변수 참조 불가 — vi.hoisted로 모킹용 fn 사전 끌어올림.
const { getSignedUrlMock, s3SendMock, s3ConstructMock } = vi.hoisted(() => ({
  getSignedUrlMock: vi.fn(),
  s3SendMock: vi.fn(),
  s3ConstructMock: vi.fn(), // A-MAJOR-3: S3Client 생성 횟수 추적 (HMR 싱글톤 회귀 가드)
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
    constructor(public config: Record<string, unknown>) {
      s3ConstructMock();
    }
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
  safeS3Cause,
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
  s3ConstructMock.mockReset();
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

  // D-MINOR-1 (CANDID-040): 확장자 화이트리스트 SSOT — RESUME_ALLOWED_EXTS만 통과.
  it.each(['pdf', 'docx', 'doc', 'hwp', 'hwpx'])('화이트리스트 확장자 .%s 통과', (ext) => {
    expect(
      isValidResumeStoredPath(`resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.${ext}`),
    ).toBe(true);
  });

  it.each([
    ['외부 prefix', '../etc/passwd'],
    ['잘못된 prefix', 'avatars/2026/05/01234567-89ab-cdef-0123-456789abcdef.pdf'],
    ['월 2자리 불만족', 'resumes/2026/5/01234567-89ab-cdef-0123-456789abcdef.pdf'],
    ['UUID 형식 위반', 'resumes/2026/05/not-a-uuid.pdf'],
    ['확장자 누락', 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef'],
    ['빈 문자열', ''],
    // D-MINOR-1: 위조 storedPath의 비화이트리스트 확장자 차단 (기존 [a-z0-9]{1,5}는 통과시켰음).
    ['실행 파일 위장 .exe', 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.exe'],
    ['압축 .zip', 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.zip'],
    ['임의 5자 확장자 .abcde', 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.abcde'],
  ])('%s 거부: %s', (_label, input) => {
    expect(isValidResumeStoredPath(input)).toBe(false);
  });

  // D-MINOR-1: 'bin'은 buildResumeKey 폴백 확장자 — round-trip 불변식 유지 위해 인정.
  it("'.bin' 폴백 키는 통과 (buildResumeKey round-trip 불변식)", () => {
    expect(
      isValidResumeStoredPath('resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.bin'),
    ).toBe(true);
  });
});

// A-MAJOR-3 (CANDID-040): HMR-safe globalThis 싱글톤 회귀 가드.
describe('S3Client 싱글톤 (A-MAJOR-3)', () => {
  it('여러 presign 호출이 S3Client를 1회만 생성 (globalThis 캐시 재사용)', async () => {
    stubS3Env();
    getSignedUrlMock.mockResolvedValue('https://minio.local/upload?sig=abc');
    await presignResumeUpload('a.pdf', 'application/pdf');
    await presignResumeUpload('b.pdf', 'application/pdf');
    expect(s3ConstructMock).toHaveBeenCalledTimes(1);
  });

  it('__resetStorageClientForTesting 후에는 재생성 (캐시 초기화 검증)', async () => {
    stubS3Env();
    getSignedUrlMock.mockResolvedValue('https://minio.local/upload?sig=abc');
    await presignResumeUpload('a.pdf', 'application/pdf');
    __resetStorageClientForTesting();
    await presignResumeUpload('b.pdf', 'application/pdf');
    expect(s3ConstructMock).toHaveBeenCalledTimes(2);
  });
});

describe('presignResumeUpload', () => {
  it('S3 미구성 시 SYS_DEPENDENCY_UNAVAILABLE throw (A-MAJOR-2 fix)', async () => {
    // 구성 미흡과 호출 실패를 분리 — 운영 알람 분기 가능 (503 vs 500).
    await expect(presignResumeUpload('a.pdf', 'application/pdf')).rejects.toMatchObject({
      code: 'SYS_DEPENDENCY_UNAVAILABLE',
    });
  });

  it('성공 시 uploadUrl/storedPath/headers/expiresAt 반환', async () => {
    stubS3Env();
    getSignedUrlMock.mockResolvedValue('https://minio.local/upload?sig=abc');
    const now = new Date(Date.UTC(2026, 4, 24, 10, 30, 0));

    const callStart = Date.now();
    const result = await presignResumeUpload('이력서.pdf', 'application/pdf', now);
    const callEnd = Date.now();

    expect(result.uploadUrl).toBe('https://minio.local/upload?sig=abc');
    expect(result.storedPath).toMatch(/^resumes\/2026\/05\/.+\.pdf$/);
    expect(result.headers).toEqual({ 'Content-Type': 'application/pdf' });
    // D-MAJOR-3 fix: expiresAt = signedAt(call 진입 직후) + 300_000 - SAFETY_MARGIN(5_000).
    // 호출자 `now`가 아닌 함수 진입 직후 시각 기준이므로 범위 어설션 (call 구간 + ±50ms 흡수).
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(callStart + 300_000 - 5_000 - 50);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(callEnd + 300_000 - 5_000 + 50);
    // T-MINOR: ttlSec를 expiresIn으로 전달했는지 검증 (BR-FILE-05 회귀 가드).
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ expiresIn: 300 }),
    );
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

// T-MAJOR-1 fix (PR #57 in-PR): 라운드 트립 invariant.
// buildResumeKey / presignResumeUpload가 만든 키는 반드시 isValidResumeStoredPath()를 통과해야 한다.
// Step 2 confirm 단계의 storedPath 위변조 가드 정합성을 회귀로부터 잠근다.
describe('storedPath round-trip invariant (T-MAJOR-1 fix)', () => {
  const fixed = new Date(Date.UTC(2026, 4, 24, 10, 30, 0));

  it.each([
    'a.pdf',
    'b.PDF',
    'noext',
    'shell.exe.malicious',
    '../etc/passwd',
    'report.v1.docx',
    '이력서.pdf',
    'CV.HWPx',
  ])('buildResumeKey(%s) → isValidResumeStoredPath true', (input) => {
    const key = buildResumeKey(input, fixed);
    expect(isValidResumeStoredPath(key)).toBe(true);
  });

  it('presignResumeUpload result.storedPath → isValidResumeStoredPath true', async () => {
    stubS3Env();
    getSignedUrlMock.mockResolvedValue('https://x');
    const { storedPath } = await presignResumeUpload('a.pdf', 'application/pdf');
    expect(isValidResumeStoredPath(storedPath)).toBe(true);
  });

  // T-MAJOR-10 보강: 월 경계 (12월 → 익년 1월) UTC 케이스.
  it('월 경계 — 12월/익년 1월 키 경로 정합', () => {
    expect(
      buildResumeKey('a.pdf', new Date(Date.UTC(2026, 11, 31, 23, 59, 59))),
    ).toMatch(/^resumes\/2026\/12\/.+\.pdf$/);
    expect(buildResumeKey('a.pdf', new Date(Date.UTC(2027, 0, 1, 0, 0, 0)))).toMatch(
      /^resumes\/2027\/01\/.+\.pdf$/,
    );
  });
});

// T-MAJOR-2 fix (PR #58 in-PR): safeS3Cause 화이트리스트 회귀 가드.
// SDK 원본 메시지/endpoint/signature가 cause 직렬화로 누출되지 않도록 필드를 좁힌다.
describe('safeS3Cause (T-MAJOR-2 fix)', () => {
  it('S3ServiceException → {name, statusCode, requestId} 만 추출', () => {
    const ex = new S3ServiceException({
      name: 'AccessDenied',
      message: 'Signature=AKIA...secret_leak',
      $fault: 'client',
      $metadata: { httpStatusCode: 403, requestId: 'req-abc-123' },
    });
    const cause = safeS3Cause(ex);
    expect(cause).toEqual({
      name: 'AccessDenied',
      statusCode: 403,
      requestId: 'req-abc-123',
    });
    // 화이트리스트 외 필드 부재 가드 — message/endpoint/signature 누출 차단.
    expect(Object.keys(cause).sort()).toEqual(['name', 'requestId', 'statusCode']);
    expect(JSON.stringify(cause)).not.toContain('secret_leak');
  });

  it('일반 Error → {name} 만', () => {
    const cause = safeS3Cause(new TypeError('something broke'));
    expect(cause).toEqual({ name: 'TypeError' });
    expect(JSON.stringify(cause)).not.toContain('broke');
  });

  it('unknown (객체/null/undefined) → {name: UnknownError}', () => {
    expect(safeS3Cause({ foo: 'bar' })).toEqual({ name: 'UnknownError' });
    expect(safeS3Cause(null)).toEqual({ name: 'UnknownError' });
    expect(safeS3Cause(undefined)).toEqual({ name: 'UnknownError' });
    expect(safeS3Cause('plain string')).toEqual({ name: 'UnknownError' });
  });

  it('$metadata 누락 — statusCode/requestId undefined', () => {
    const ex = new S3ServiceException({
      name: 'InternalError',
      message: 'x',
      $fault: 'server',
      $metadata: {},
    });
    const cause = safeS3Cause(ex);
    expect(cause.name).toBe('InternalError');
    expect(cause.statusCode).toBeUndefined();
    expect(cause.requestId).toBeUndefined();
  });
});

// D-MAJOR-1/S-MAJOR-1 fix (PR #58 in-PR) 회귀 가드: confirm.test.ts에서 검증되는 정책이 깨지지 않도록
// 본 storage 모듈에서 노출하는 정규식 가드는 별도 확장자 화이트리스트 가지지 않음(이중 방어로 validation.ts 책임).
// 향후 확장자 화이트리스트 통합 시 D-MINOR-1 SSOT 가드 추가 가능.
