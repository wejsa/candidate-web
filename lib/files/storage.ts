import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';

// CANDID-016 Step 1 — S3/MinIO presigned PUT URL 발급 + 객체 삭제 헬퍼.
// **호출 위치**: Route Handler / Server Action (Node runtime). middleware/Edge 금지.
// **부분 설정 부팅 차단**: env.ts superRefine이 S3_* 4-tuple을 강제하므로 본 모듈은
// "모두 set" 또는 "모두 unset" 두 상태만 가정. 후자에서는 호출 시 FILE_UPLOAD_FAILED throw.

let cachedClient: S3Client | null = null;

function isStorageConfigured(): boolean {
  const env = getEnv();
  return (
    typeof env.S3_ENDPOINT === 'string' &&
    typeof env.S3_BUCKET === 'string' &&
    typeof env.S3_ACCESS_KEY === 'string' &&
    typeof env.S3_SECRET_KEY === 'string'
  );
}

function getClient(): { client: S3Client; bucket: string; ttlSec: number } {
  if (!isStorageConfigured()) {
    // 저장소 비활성 모드 — env.ts superRefine 통과 (4개 모두 unset)했더라도
    // 파일 API 호출은 차단 (운영 staging에서 누락 인지 보조).
    throw new AppError('FILE_UPLOAD_FAILED', { message: '파일 저장소가 구성되지 않았습니다.' });
  }
  const env = getEnv();
  if (cachedClient === null) {
    cachedClient = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: 'auto',
      // MinIO 호환 — 일부 호환 스토리지는 path-style만 지원.
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY as string,
        secretAccessKey: env.S3_SECRET_KEY as string,
      },
    });
  }
  return {
    client: cachedClient,
    bucket: env.S3_BUCKET as string,
    ttlSec: env.S3_PRESIGN_TTL_SEC,
  };
}

// BR-FILE-03: UUID 재명명. 원본 파일명은 별도 컬럼 보존.
// 키 형식: `resumes/{YYYY}/{MM}/{uuid-v4}.{ext}` — 월별 prefix로 S3 lifecycle/장기 관리 단순화.
// confirm 단계의 storedPath 위변조 가드가 본 정규식과 정합되어야 한다 (lib/files/confirm.ts).
const KEY_PREFIX = 'resumes' as const;
const ALLOWED_EXT_RE = /^[a-z0-9]{1,5}$/;

export function buildResumeKey(originalFilename: string, now: Date = new Date()): string {
  const lastDot = originalFilename.lastIndexOf('.');
  const rawExt = lastDot >= 0 ? originalFilename.slice(lastDot + 1).toLowerCase() : '';
  // 검증은 lib/files/validation.ts의 책임 — 여기서는 키 안전성만 보장 (경로 traversal 차단).
  const ext = ALLOWED_EXT_RE.test(rawExt) ? rawExt : 'bin';
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${KEY_PREFIX}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

// confirm 단계에서 storedPath가 본 함수가 만든 형식과 일치하는지 검증.
// 외부 prefix 주입 (예: "../etc/passwd") 차단.
const STORED_PATH_RE = new RegExp(
  `^${KEY_PREFIX}/\\d{4}/\\d{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]{1,5}$`,
);

export function isValidResumeStoredPath(storedPath: string): boolean {
  return STORED_PATH_RE.test(storedPath);
}

export interface PresignedPutResult {
  uploadUrl: string;
  storedPath: string;
  headers: { 'Content-Type': string };
  expiresAt: Date;
}

export async function presignResumeUpload(
  originalFilename: string,
  contentType: string,
  now: Date = new Date(),
): Promise<PresignedPutResult> {
  const { client, bucket, ttlSec } = getClient();
  const storedPath = buildResumeKey(originalFilename, now);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storedPath,
    ContentType: contentType,
  });
  try {
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: ttlSec });
    return {
      uploadUrl,
      storedPath,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(now.getTime() + ttlSec * 1000),
    };
  } catch (cause) {
    throw new AppError('FILE_UPLOAD_FAILED', {
      message: 'presigned URL 발급에 실패했습니다.',
      cause,
    });
  }
}

export async function deleteResumeObject(storedPath: string): Promise<void> {
  // 호출자는 이미 자기 소유 row의 storedPath만 전달한다고 가정.
  // 추가 방어로 형식 가드 — 외부 키 삭제 차단.
  if (!isValidResumeStoredPath(storedPath)) {
    throw new AppError('FILE_UPLOAD_FAILED', { message: '잘못된 storedPath 형식입니다.' });
  }
  const { client, bucket } = getClient();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storedPath }));
  } catch (cause) {
    // 키가 이미 없으면 멱등 성공 — S3 DeleteObject는 NoSuchKey 시에도 204를 반환.
    if (cause instanceof S3ServiceException && cause.name === 'NoSuchKey') return;
    throw new AppError('FILE_UPLOAD_FAILED', { message: '파일 삭제에 실패했습니다.', cause });
  }
}

/**
 * 테스트 전용 — S3Client 싱글톤 캐시 초기화.
 * @internal
 */
export function __resetStorageClientForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetStorageClientForTesting must not be called in production');
  }
  cachedClient = null;
}
