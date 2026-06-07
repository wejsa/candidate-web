import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { RESUME_ALLOWED_EXTS } from '@/lib/files/validation';

// CANDID-016 Step 1 — S3/MinIO presigned PUT URL 발급 + 객체 삭제 헬퍼.
// **호출 위치**: Route Handler / Server Action (Node runtime). middleware/Edge 금지.
// **부분 설정 부팅 차단**: env.ts superRefine이 S3_* 4-tuple을 강제하므로 본 모듈은
// "모두 set" 또는 "모두 unset" 두 상태만 가정. 후자에서는 SYS_DEPENDENCY_UNAVAILABLE throw
// (A-MAJOR-2 fix: 구성 미흡과 호출 실패 코드 분리 — 운영 알람 분기 가능).

// A-MAJOR-3 fix (CANDID-040): HMR-safe 싱글톤. 모듈 스코프 `let`은 Next.js dev의 모듈 hot-reload마다
// 새 S3Client를 만들어 소켓/핸들러를 누수시킨다. globalThis 캐시로 reload 간 단일 인스턴스를 보장
// (Prisma 클라이언트 권장 패턴과 동일). production에서도 동작 동일(모듈 1회 평가라 사실상 모듈 싱글톤).
const globalForS3 = globalThis as unknown as { __resumeS3Client?: S3Client | null };

function isStorageConfigured(): boolean {
  const env = getEnv();
  return (
    typeof env.S3_ENDPOINT === 'string' &&
    typeof env.S3_BUCKET === 'string' &&
    typeof env.S3_ACCESS_KEY === 'string' &&
    typeof env.S3_SECRET_KEY === 'string'
  );
}

// S-MAJOR-2 fix (PR #57 carry): S3 SDK 원본 에러를 직접 cause에 전달하지 않고 safe 필드만 추출.
// requestId / endpoint / signature 등이 향후 로깅 sink(Sentry/pino) 직렬화로 누출되는 위험 차단.
// T-MAJOR-2 fix (PR #58 in-PR): export로 단위 테스트 노출 — 화이트리스트 회귀 가드.
export function safeS3Cause(cause: unknown): {
  name: string;
  statusCode?: number;
  requestId?: string;
} {
  if (cause instanceof S3ServiceException) {
    return {
      name: cause.name,
      statusCode: cause.$metadata?.httpStatusCode,
      requestId: cause.$metadata?.requestId,
    };
  }
  if (cause instanceof Error) return { name: cause.name };
  return { name: 'UnknownError' };
}

function getClient(): { client: S3Client; bucket: string; ttlSec: number } {
  if (!isStorageConfigured()) {
    // A-MAJOR-2 fix: 구성 미흡은 운영 알람상 503(SYS_DEPENDENCY_UNAVAILABLE) — 호출 실패(500)와 분리.
    throw new AppError('SYS_DEPENDENCY_UNAVAILABLE', {
      message: '파일 저장소가 구성되지 않았습니다.',
    });
  }
  const env = getEnv();
  if (!globalForS3.__resumeS3Client) {
    // A-MAJOR-1 fix (PR #57 carry): connection/socket timeout + maxAttempts 명시.
    // 외부 S3/MinIO 장애 시 Next.js Route Handler가 무한 대기 → worker hang 차단.
    // presign은 네트워크 호출 없으나 deleteObject는 실제 PUT/DELETE → 본 핸들러 영향.
    const requestHandler = new NodeHttpHandler({
      connectionTimeout: 2_000, // TCP 연결 2초
      socketTimeout: 10_000, // 응답 10초 (delete가 주 IO)
    });
    globalForS3.__resumeS3Client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: 'auto',
      // MinIO 호환 — 일부 호환 스토리지는 path-style만 지원.
      forcePathStyle: true,
      maxAttempts: 3,
      requestHandler,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY as string,
        secretAccessKey: env.S3_SECRET_KEY as string,
      },
    });
  }
  return {
    client: globalForS3.__resumeS3Client,
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
// D-MINOR-1 fix (CANDID-040): 확장자 그룹을 RESUME_ALLOWED_EXTS SSOT에서 도출. 기존 `[a-z0-9]{1,5}`는
// 위조 storedPath의 임의 확장자(.exe/.zip 등)를 통과시켜 화이트리스트와 단절돼 있었다.
// 'bin'은 buildResumeKey가 비정상 입력(확장자 누락/traversal 등)에 부여하는 폴백 키 확장자이므로
// round-trip 불변식 유지를 위해 함께 인정한다(검증은 validation.ts가 presign 전에 이미 수행 —
// 정상 플로우에서 'bin' 키는 생성되지 않으며, 임의 확장자 차단이라는 보안 목표는 그대로 달성).
const STORED_PATH_EXT_GROUP = [...RESUME_ALLOWED_EXTS, 'bin'].join('|');
const STORED_PATH_RE = new RegExp(
  `^${KEY_PREFIX}/\\d{4}/\\d{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${STORED_PATH_EXT_GROUP})$`,
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

// D-MAJOR-3 fix (PR #57 in-PR): 클럭 스큐 + 함수 호출~서명 발급 사이 지연을 흡수하는 안전 마진.
// 클라이언트가 expiresAt - 수 초 시점에 PUT 시작해도 서명 만료 직전이 아닌 명확히 만료 전임을
// 보장. 5s는 일반 환경의 시계 스큐 + 짧은 네트워크 지연 합 추정. SDK 서명의 X-Amz-Date 기준.
const PRESIGN_SAFETY_MARGIN_MS = 5_000;

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
  // D-MAJOR-3 fix: getSignedUrl 직전 시각 캡처. 호출자 `now`(검증/DB 조회 등 거친 stale 시점)와
  // SDK 내부 서명 시점 사이 지연으로 인한 expiresAt 과대표시를 차단.
  const signedAt = new Date();
  try {
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: ttlSec });
    return {
      uploadUrl,
      storedPath,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(signedAt.getTime() + ttlSec * 1000 - PRESIGN_SAFETY_MARGIN_MS),
    };
  } catch (cause) {
    // S-MAJOR-2 fix: cause 정제 후 전달 — SDK 원본 메시지 leak 차단.
    throw new AppError('FILE_UPLOAD_FAILED', {
      message: 'presigned URL 발급에 실패했습니다.',
      cause: safeS3Cause(cause),
    });
  }
}

// CANDID-066 — 운영자 이력서 다운로드용 짧은 TTL. 1회성 열람 의도(60초).
const RESUME_DOWNLOAD_TTL_SEC = 60;

export interface PresignedGetResult {
  url: string;
  expiresAt: Date;
}

/** CANDID-066 — 운영자 이력서 다운로드 presigned GET URL.
 *  - storedPath 형식 가드(외부 키 주입 차단, presignResumeUpload와 동일 정신).
 *  - ResponseContentDisposition으로 원본 파일명 다운로드 유도(RFC 5987 — 한글 파일명 안전 인코딩).
 *  - 짧은 TTL(60s). presign 자체는 네트워크 호출 없음(로컬 서명). */
export async function presignResumeDownload(
  storedPath: string,
  originalFilename: string,
): Promise<PresignedGetResult> {
  if (!isValidResumeStoredPath(storedPath)) {
    throw new AppError('SYS_VALIDATION_FAILED', { message: '잘못된 storedPath 형식입니다.' });
  }
  const { client, bucket } = getClient();
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(originalFilename)}`;
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storedPath,
    ResponseContentDisposition: disposition,
  });
  const signedAt = new Date();
  try {
    const url = await getSignedUrl(client, command, { expiresIn: RESUME_DOWNLOAD_TTL_SEC });
    return {
      url,
      expiresAt: new Date(
        signedAt.getTime() + RESUME_DOWNLOAD_TTL_SEC * 1000 - PRESIGN_SAFETY_MARGIN_MS,
      ),
    };
  } catch (cause) {
    throw new AppError('FILE_UPLOAD_FAILED', {
      message: 'presigned 다운로드 URL 발급에 실패했습니다.',
      cause: safeS3Cause(cause),
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
    // S-MAJOR-2 fix: cause 정제 후 전달.
    throw new AppError('FILE_UPLOAD_FAILED', {
      message: '파일 삭제에 실패했습니다.',
      cause: safeS3Cause(cause),
    });
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
  globalForS3.__resumeS3Client = null;
}
