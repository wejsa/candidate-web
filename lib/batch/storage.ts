import { DeleteObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { getEnv } from '@/lib/env';
import { RESUME_ALLOWED_EXTS } from '@/lib/files/validation';

// CANDID-029 Step 2 — 배치(CLI) 전용 S3 객체 삭제기.
//
// 왜 lib/files/storage.ts를 재사용하지 않는가: 해당 모듈은 'server-only'(Next.js RSC 가드)를
// import하므로 tsx CLI 컨텍스트에서 throw한다(lib/prisma와 동일 제약 — prisma/seed.ts 선례).
// 앱 경로(presign/confirm)는 계속 storage.ts를 사용하고, 본 모듈은 **배치 정리 경로의 삭제 한정**으로
// 최소 클라이언트만 구성한다. 설정(endpoint/region/timeout/forcePathStyle)은 storage.ts와 동일 시맨틱.

const globalForBatchS3 = globalThis as unknown as { __batchS3Client?: S3Client | null };

const KEY_PREFIX = 'resumes';
// storage.ts STORED_PATH_RE와 동일 — 외부/위조 키 삭제 차단(확장자 SSOT는 validation.ts에서 도출).
const STORED_PATH_RE = new RegExp(
  `^${KEY_PREFIX}/\\d{4}/\\d{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${[
    ...RESUME_ALLOWED_EXTS,
    'bin',
  ].join('|')})$`,
);

function isValidStoredPath(storedPath: string): boolean {
  return STORED_PATH_RE.test(storedPath);
}

function getBatchClient(): { client: S3Client; bucket: string } {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = getEnv();
  if (
    S3_ENDPOINT === undefined ||
    S3_BUCKET === undefined ||
    S3_ACCESS_KEY === undefined ||
    S3_SECRET_KEY === undefined
  ) {
    throw new Error('batch S3 deletion requires S3_* configuration');
  }
  if (!globalForBatchS3.__batchS3Client) {
    globalForBatchS3.__batchS3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: 'auto',
      forcePathStyle: true, // MinIO 호환
      maxAttempts: 3,
      requestHandler: new NodeHttpHandler({ connectionTimeout: 2_000, socketTimeout: 10_000 }),
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    });
  }
  return { client: globalForBatchS3.__batchS3Client, bucket: S3_BUCKET };
}

/**
 * 배치 정리용 S3 객체 삭제. 잘못된 키 형식은 거부(외부 키 삭제 차단).
 * NoSuchKey는 멱등 성공으로 처리(이미 삭제된 객체).
 */
export async function deleteBatchObject(storedPath: string): Promise<void> {
  if (!isValidStoredPath(storedPath)) {
    throw new Error('invalid storedPath rejected'); // PII/경로 비노출
  }
  const { client, bucket } = getBatchClient();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storedPath }));
  } catch (cause) {
    if (cause instanceof S3ServiceException && cause.name === 'NoSuchKey') return; // 멱등
    throw cause;
  }
}

/** 테스트 전용 — 배치 S3Client 싱글톤 캐시 초기화. @internal */
export function __resetBatchS3ClientForTesting(): void {
  globalForBatchS3.__batchS3Client = null;
}
