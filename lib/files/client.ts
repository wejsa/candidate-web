// CANDID-016 Step 3 — 브라우저 측 이력서 업로드 모듈.
//
// 호출 순서: presign API → S3 PUT (XHR — 진행률 + abort) → confirm API.
// XMLHttpRequest 사용 이유: fetch API의 진행률 이벤트는 ReadableStream 기반이라 브라우저 호환성과
// 사용성 모두 떨어짐 (특히 업로드 진행률은 fetch 미지원). XHR이 표준.

// presign API 응답 — Step 2 route.ts와 정합 유지.
export interface PresignResponse {
  uploadUrl: string;
  storedPath: string;
  headers: Record<string, string>;
  expiresAt: string; // ISO string
  replacedPaths: string[];
}

export interface ConfirmResponse {
  id: number;
  virusScanStatus: 'PENDING' | 'CLEAN' | 'INFECTED';
  uploadedAt: string;
}

export interface UploadParams {
  draftId: number;
  file: File;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export interface UploadResult {
  resumeFileId: number;
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED';
}

/** HTTP 에러를 status 코드와 함께 throw — upload-state.ts classifyUploadError가 매핑 */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
    this.code = code;
  }
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    let code: string | undefined;
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { code?: string; message?: string };
      code = data.code;
      if (typeof data.message === 'string') message = data.message;
    } catch {
      // ignore JSON parse error — 텍스트 응답은 message 기본값 유지
    }
    throw new HttpStatusError(res.status, message, code);
  }
  return (await res.json()) as T;
}

/** XHR PUT — 업로드 진행률 + 취소 지원. fetch 미사용 (upload progress event 부재). */
function xhrPut(args: {
  url: string;
  body: File;
  headers: Record<string, string>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', args.url);
    // A-MAJOR-1 fix (PR #59 in-PR): S3/MinIO 장애 hang 방어. 60s는 10MB 파일을 150KB/s 회선에서도
    // 완료 가능한 마진. 더 큰 파일/엄격한 SLA 시 환경 변수 분리 권장.
    xhr.timeout = 60_000;
    for (const [k, v] of Object.entries(args.headers)) xhr.setRequestHeader(k, v);

    if (args.onProgress !== undefined) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          args.onProgress?.(percent);
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new HttpStatusError(xhr.status, `S3 PUT 실패 (${xhr.status})`));
      }
    });
    xhr.addEventListener('error', () => {
      reject(new HttpStatusError(0, '네트워크 오류로 업로드 실패'));
    });
    xhr.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    });
    // A-MAJOR-1 fix (PR #59 in-PR): timeout 이벤트 처리 — status=0으로 network 분류.
    xhr.addEventListener('timeout', () => {
      reject(new HttpStatusError(0, '업로드 시간이 초과되었습니다. 다시 시도해 주세요.'));
    });

    if (args.signal !== undefined) {
      if (args.signal.aborted) {
        xhr.abort();
        return;
      }
      args.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(args.body);
  });
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 단일 파일 업로드 — presign → S3 PUT → confirm.
 * 사용자 취소(signal)는 단계별 모두 propagate.
 */
export async function uploadResumeFile(params: UploadParams): Promise<UploadResult> {
  const { draftId, file, onProgress, signal } = params;

  // 1. presign 발급. abort 가능.
  const presign = await postJson<PresignResponse>(
    '/api/v1/files/resume/presign',
    {
      draftId,
      originalFilename: file.name,
      contentType: file.type,
      fileSize: file.size,
    },
    signal,
  );

  // 2. S3 PUT — 진행률 + abort. presigned URL은 외부 origin이라 CORS preflight 발생 가능.
  await xhrPut({
    url: presign.uploadUrl,
    body: file,
    headers: presign.headers,
    onProgress,
    signal,
  });

  // 3. checksum 계산 후 confirm. 큰 파일은 백그라운드 워커 분리 권장이지만 본 task는 단순 구현.
  const checksumSha256 = await sha256Hex(file);
  const confirm = await postJson<ConfirmResponse>(
    '/api/v1/files/resume/confirm',
    {
      draftId,
      storedPath: presign.storedPath,
      originalFilename: file.name,
      contentType: file.type,
      fileSize: file.size,
      checksumSha256,
    },
    signal,
  );

  return {
    resumeFileId: confirm.id,
    scanStatus: confirm.virusScanStatus === 'INFECTED' ? 'INFECTED' : confirm.virusScanStatus,
  };
}
