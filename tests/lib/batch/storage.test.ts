import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factory는 hoisting → vi.hoisted로 모킹 fn 사전 끌어올림 (storage.test.ts 패턴 미러).
const { s3SendMock } = vi.hoisted(() => ({ s3SendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => {
  class S3ServiceException extends Error {
    constructor(opts: { name: string; message: string }) {
      super(opts.message);
      this.name = opts.name;
    }
  }
  class DeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class S3Client {
    constructor(public config: Record<string, unknown>) {}
    send = s3SendMock;
  }
  return { S3Client, DeleteObjectCommand, S3ServiceException };
});

import { S3ServiceException } from '@aws-sdk/client-s3';
import { __resetCachedEnvForTesting } from '@/lib/env';
import { __resetBatchS3ClientForTesting, deleteBatchObject } from '@/lib/batch/storage';

const VALID_PATH = 'resumes/2026/05/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf';

function stubS3Env(): void {
  vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
  vi.stubEnv('S3_BUCKET', 'candidate-web-resumes');
  vi.stubEnv('S3_ACCESS_KEY', 'candidate');
  vi.stubEnv('S3_SECRET_KEY', 'candidate-dev-secret');
  __resetCachedEnvForTesting();
}

beforeEach(() => {
  s3SendMock.mockReset();
  __resetBatchS3ClientForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCachedEnvForTesting();
  __resetBatchS3ClientForTesting();
});

describe('deleteBatchObject', () => {
  it('잘못된 storedPath 형식은 거부(S3 호출 없음)', async () => {
    stubS3Env();
    await expect(deleteBatchObject('../etc/passwd')).rejects.toThrow();
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it('유효 키는 DeleteObjectCommand(Bucket/Key)로 삭제', async () => {
    stubS3Env();
    s3SendMock.mockResolvedValueOnce({});
    await deleteBatchObject(VALID_PATH);

    expect(s3SendMock).toHaveBeenCalledOnce();
    const cmd = s3SendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(cmd.input).toEqual({ Bucket: 'candidate-web-resumes', Key: VALID_PATH });
  });

  it('NoSuchKey는 멱등 성공(throw 안 함)', async () => {
    stubS3Env();
    s3SendMock.mockRejectedValueOnce(
      new S3ServiceException({
        name: 'NoSuchKey',
        message: 'not found',
        $fault: 'client',
        $metadata: {},
      }),
    );
    await expect(deleteBatchObject(VALID_PATH)).resolves.toBeUndefined();
  });

  it('S3 미구성 시 throw(호출자가 draft skip 처리)', async () => {
    // setup.ts가 S3_* 를 delete(undefined)한 상태 — 전부 unset이면 env는 통과하되
    // getBatchClient가 구성 부재를 감지해 throw(호출자 cleanupStaleDrafts가 draft를 skip).
    __resetCachedEnvForTesting();
    await expect(deleteBatchObject(VALID_PATH)).rejects.toThrow(/S3_\* configuration/);
  });
});
