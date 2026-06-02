// CANDID-016 Step 3 — lib/files/client.ts 단위 테스트 (jsdom 환경).
//
// fetch(presign/confirm) + XHR PUT을 mock하여 비즈니스 흐름만 검증.
// XMLHttpRequest는 jsdom 기본 제공 — globalThis.XMLHttpRequest를 직접 stub.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSecureUploadUrl, HttpStatusError, uploadResumeFile } from '@/lib/files/client';

// XHR stub — open/setRequestHeader/send/abort + event listeners + upload.progress emit.
class FakeXHR {
  static instances: FakeXHR[] = [];
  status = 0;
  readyState = 0;
  upload = {
    _listeners: new Map<string, ((e: unknown) => void)[]>(),
    addEventListener(this: { _listeners: Map<string, ((e: unknown) => void)[]> }, evt: string, cb: (e: unknown) => void) {
      const list = this._listeners.get(evt) ?? [];
      list.push(cb);
      this._listeners.set(evt, list);
    },
  };
  _listeners = new Map<string, ((e: unknown) => void)[]>();
  _aborted = false;
  open(_method: string, _url: string) {
    /* no-op */
  }
  setRequestHeader(_k: string, _v: string) {
    /* no-op */
  }
  addEventListener(evt: string, cb: (e: unknown) => void) {
    const list = this._listeners.get(evt) ?? [];
    list.push(cb);
    this._listeners.set(evt, list);
  }
  send(_body: unknown) {
    FakeXHR.instances.push(this);
  }
  abort() {
    this._aborted = true;
    this.emit('abort');
  }
  emit(evt: string) {
    (this._listeners.get(evt) ?? []).forEach((cb) => cb(undefined));
  }
  emitProgress(loaded: number, total: number) {
    (this.upload._listeners.get('progress') ?? []).forEach((cb) =>
      cb({ lengthComputable: true, loaded, total }),
    );
  }
  // T-MAJOR-2 (CANDID-040): lengthComputable=false 진행 이벤트 — 총 크기 미상 시 onProgress 미호출 검증용.
  emitProgressNonComputable() {
    (this.upload._listeners.get('progress') ?? []).forEach((cb) =>
      cb({ lengthComputable: false, loaded: 0, total: 0 }),
    );
  }
  loadSuccess(status: number) {
    this.status = status;
    this.emit('load');
  }
  loadError() {
    this.emit('error');
  }
}

beforeEach(() => {
  FakeXHR.instances = [];
  // jsdom 25의 webcrypto는 ArrayBuffer 인스턴스 검사가 엄격 — 결정적 mock으로 강제 교체.
  vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32));
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeFetchOk<T>(body: T): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function fakeFetchError(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const presignResponse = {
  uploadUrl: 'https://minio.local/upload?sig=abc',
  storedPath: 'resumes/2026/05/01234567-89ab-cdef-0123-456789abcdef.pdf',
  headers: { 'Content-Type': 'application/pdf' },
  expiresAt: '2026-05-25T00:05:00Z',
  replacedPaths: [],
};

const confirmResponse = {
  id: 99,
  virusScanStatus: 'PENDING' as const,
  uploadedAt: '2026-05-25T00:10:00Z',
};

function makeFile(): File {
  const blob = new Blob(['fake pdf content'], { type: 'application/pdf' });
  const file = new File([blob], 'CV.pdf', { type: 'application/pdf' });
  // jsdom 25 — File에 arrayBuffer 메서드가 없어 명시 추가 (sha256Hex 호출 대응).
  if (typeof (file as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer !== 'function') {
    (file as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () => new ArrayBuffer(16);
  }
  return file;
}

describe('uploadResumeFile 정상 흐름', () => {
  it('presign → XHR PUT → confirm 호출 + scanStatus 반환', async () => {
    let call = 0;
    const fetchMock = vi.fn(async (url: string) => {
      call++;
      if (url.endsWith('/presign')) return { ok: true, json: async () => presignResponse } as Response;
      if (url.endsWith('/confirm')) return { ok: true, json: async () => confirmResponse } as Response;
      throw new Error('unknown url');
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = makeFile();
    const promise = uploadResumeFile({ draftId: 7, file });

    // XHR 인스턴스 등장까지 대기
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeXHR.instances.length).toBe(1);
    FakeXHR.instances[0]!.loadSuccess(200);

    const result = await promise;
    expect(result).toEqual({ resumeFileId: 99, scanStatus: 'PENDING' });
    expect(call).toBe(2);
  });

  it('onProgress 콜백 — XHR upload.progress 이벤트 전달', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/presign'))
          return { ok: true, json: async () => presignResponse } as Response;
        return { ok: true, json: async () => confirmResponse } as Response;
      }),
    );
    const progresses: number[] = [];
    const promise = uploadResumeFile({
      draftId: 7,
      file: makeFile(),
      onProgress: (p) => progresses.push(p),
    });
    await new Promise((r) => setTimeout(r, 0));
    FakeXHR.instances[0]!.emitProgress(50, 100);
    FakeXHR.instances[0]!.emitProgress(100, 100);
    FakeXHR.instances[0]!.loadSuccess(200);
    await promise;
    expect(progresses).toEqual([50, 100]);
  });
});

describe('uploadResumeFile 실패 처리', () => {
  it('presign 422 → HttpStatusError 전파', async () => {
    vi.stubGlobal('fetch', fakeFetchError(422, { code: 'FILE_TYPE_NOT_ALLOWED', message: 'invalid' }));
    await expect(
      uploadResumeFile({ draftId: 7, file: makeFile() }),
    ).rejects.toBeInstanceOf(HttpStatusError);
  });

  it('S3 PUT 5xx → HttpStatusError(status)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/presign'))
          return { ok: true, json: async () => presignResponse } as Response;
        throw new Error('confirm not reached');
      }),
    );
    const promise = uploadResumeFile({ draftId: 7, file: makeFile() });
    await new Promise((r) => setTimeout(r, 0));
    FakeXHR.instances[0]!.loadSuccess(503);
    await expect(promise).rejects.toMatchObject({ status: 503 });
  });

  it('AbortController abort → AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/presign'))
          return { ok: true, json: async () => presignResponse } as Response;
        throw new Error('confirm not reached');
      }),
    );
    const ctrl = new AbortController();
    const promise = uploadResumeFile({ draftId: 7, file: makeFile(), signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 0));
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('XHR network error → HttpStatusError(0)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/presign'))
          return { ok: true, json: async () => presignResponse } as Response;
        throw new Error('confirm not reached');
      }),
    );
    const promise = uploadResumeFile({ draftId: 7, file: makeFile() });
    await new Promise((r) => setTimeout(r, 0));
    FakeXHR.instances[0]!.loadError();
    await expect(promise).rejects.toMatchObject({ status: 0 });
  });
});

// T-MAJOR-2 / T-MAJOR-3 (CANDID-040): 업로드 진행률 경계 + checksum 실패 경로.
describe('uploadResumeFile — 진행률/체크섬 경계 (T-MAJOR-2/3)', () => {
  it('lengthComputable=false 진행 이벤트는 onProgress를 호출하지 않음 (T-MAJOR-2)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/presign'))
          return { ok: true, json: async () => presignResponse } as Response;
        return { ok: true, json: async () => confirmResponse } as Response;
      }),
    );
    const progresses: number[] = [];
    const promise = uploadResumeFile({
      draftId: 7,
      file: makeFile(),
      onProgress: (p) => progresses.push(p),
    });
    await new Promise((r) => setTimeout(r, 0));
    // 총 크기 미상(lengthComputable=false) → 콜백 미발화. 그 후 정상 진행은 발화.
    FakeXHR.instances[0]!.emitProgressNonComputable();
    FakeXHR.instances[0]!.emitProgress(60, 100);
    FakeXHR.instances[0]!.loadSuccess(200);
    await promise;
    expect(progresses).toEqual([60]); // non-computable 이벤트는 제외됨
  });

  it('checksum(sha256) 계산 실패 → 업로드 reject (T-MAJOR-3)', async () => {
    // presign + S3 PUT 성공 후 sha256Hex(crypto.subtle.digest)가 reject되는 경로.
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(
      new DOMException('digest failed', 'OperationError'),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/presign'))
          return { ok: true, json: async () => presignResponse } as Response;
        // confirm까지 도달하면 안 됨 (checksum 단계에서 실패).
        throw new Error('confirm must not be reached');
      }),
    );
    const promise = uploadResumeFile({ draftId: 7, file: makeFile() });
    await new Promise((r) => setTimeout(r, 0));
    FakeXHR.instances[0]!.loadSuccess(200); // S3 PUT 성공 → 이후 checksum 단계 진입
    await expect(promise).rejects.toBeInstanceOf(DOMException);
  });
});

// S-MAJOR-1 (CANDID-040): 운영 환경 HTTPS presign URL 강제.
describe('assertSecureUploadUrl (S-MAJOR-1)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('production + http URL → 차단(HttpStatusError)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertSecureUploadUrl('http://minio.local/upload?sig=abc')).toThrow(HttpStatusError);
  });

  it('production + https URL → 통과', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertSecureUploadUrl('https://s3.amazonaws.com/bucket/key?sig=abc')).not.toThrow();
  });

  it('production + 잘못된 URL → 차단', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertSecureUploadUrl('not-a-url')).toThrow(HttpStatusError);
  });

  it('development + http URL → 통과 (MinIO 로컬 허용)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => assertSecureUploadUrl('http://localhost:9000/upload')).not.toThrow();
  });
});
