import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canAbort,
  canRetry,
  classifyUploadError,
  INITIAL_UPLOAD_STATE,
  uploadReducer,
  warnIfInvalidTransition,
  type UploadState,
} from '@/lib/files/upload-state';
import { HttpStatusError } from '@/lib/files/client';

// CANDID-016 Step 3 — 상태머신 + 에러 분류 단위 테스트 (순수 함수).

const sampleFile = { name: 'CV.pdf', size: 1024, contentType: 'application/pdf' };

describe('uploadReducer 전이', () => {
  it('select — INITIAL → validating + file 보관', () => {
    const next = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'select', file: sampleFile });
    expect(next.status).toBe('validating');
    expect(next.file).toEqual(sampleFile);
    expect(next.progress).toBe(0);
  });

  it('validate-fail → failed + validation kind', () => {
    const next = uploadReducer(
      { ...INITIAL_UPLOAD_STATE, status: 'validating', file: sampleFile },
      { type: 'validate-fail', message: 'wrong ext' },
    );
    expect(next.status).toBe('failed');
    expect(next.failureKind).toBe('validation');
    expect(next.errorMessage).toBe('wrong ext');
  });

  it('upload-progress: 0..100 clamp + 반올림', () => {
    const s: UploadState = { ...INITIAL_UPLOAD_STATE, status: 'uploading', file: sampleFile };
    expect(uploadReducer(s, { type: 'upload-progress', progress: -10 }).progress).toBe(0);
    expect(uploadReducer(s, { type: 'upload-progress', progress: 150 }).progress).toBe(100);
    expect(uploadReducer(s, { type: 'upload-progress', progress: 47.6 }).progress).toBe(48);
  });

  it('confirm-success PENDING → scanning', () => {
    const next = uploadReducer(
      { ...INITIAL_UPLOAD_STATE, status: 'confirming', file: sampleFile, progress: 100 },
      { type: 'confirm-success', resumeFileId: 42, scanStatus: 'PENDING' },
    );
    expect(next.status).toBe('scanning');
    expect(next.resumeFileId).toBe(42);
    expect(next.scanStatus).toBe('PENDING');
  });

  it('confirm-success CLEAN → clean', () => {
    const next = uploadReducer(
      { ...INITIAL_UPLOAD_STATE, status: 'confirming', file: sampleFile, progress: 100 },
      { type: 'confirm-success', resumeFileId: 42, scanStatus: 'CLEAN' },
    );
    expect(next.status).toBe('clean');
    expect(next.scanStatus).toBe('CLEAN');
  });

  it('fail (network) → failed + kind=network', () => {
    const next = uploadReducer(
      { ...INITIAL_UPLOAD_STATE, status: 'uploading', file: sampleFile },
      { type: 'fail', kind: 'network', message: 'net err' },
    );
    expect(next.status).toBe('failed');
    expect(next.failureKind).toBe('network');
  });

  it('fail (aborted) → aborted 상태', () => {
    const next = uploadReducer(
      { ...INITIAL_UPLOAD_STATE, status: 'uploading', file: sampleFile },
      { type: 'fail', kind: 'aborted', message: 'cancel' },
    );
    expect(next.status).toBe('aborted');
    expect(next.failureKind).toBe('aborted');
  });

  it('abort 액션 → aborted', () => {
    const next = uploadReducer(
      { ...INITIAL_UPLOAD_STATE, status: 'uploading', file: sampleFile, progress: 50 },
      { type: 'abort' },
    );
    expect(next.status).toBe('aborted');
    expect(next.errorMessage).toMatch(/취소/);
  });

  it('reset → INITIAL_STATE', () => {
    const next = uploadReducer(
      { ...INITIAL_UPLOAD_STATE, status: 'clean', file: sampleFile, progress: 100, resumeFileId: 7 },
      { type: 'reset' },
    );
    expect(next).toEqual(INITIAL_UPLOAD_STATE);
  });
});

describe('canRetry / canAbort', () => {
  it('canRetry: failed/aborted만 true', () => {
    expect(canRetry({ ...INITIAL_UPLOAD_STATE, status: 'failed' })).toBe(true);
    expect(canRetry({ ...INITIAL_UPLOAD_STATE, status: 'aborted' })).toBe(true);
    expect(canRetry({ ...INITIAL_UPLOAD_STATE, status: 'uploading' })).toBe(false);
    expect(canRetry({ ...INITIAL_UPLOAD_STATE, status: 'clean' })).toBe(false);
  });

  it('canAbort: uploading/confirming만 true', () => {
    expect(canAbort({ ...INITIAL_UPLOAD_STATE, status: 'uploading' })).toBe(true);
    expect(canAbort({ ...INITIAL_UPLOAD_STATE, status: 'confirming' })).toBe(true);
    expect(canAbort({ ...INITIAL_UPLOAD_STATE, status: 'idle' })).toBe(false);
    expect(canAbort({ ...INITIAL_UPLOAD_STATE, status: 'clean' })).toBe(false);
  });
});

describe('classifyUploadError', () => {
  it('AbortError → aborted', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(classifyUploadError(err).kind).toBe('aborted');
  });

  it('HttpStatusError 401/403 → forbidden', () => {
    expect(classifyUploadError(new HttpStatusError(401, 'unauthorized')).kind).toBe('forbidden');
    expect(classifyUploadError(new HttpStatusError(403, 'forbidden')).kind).toBe('forbidden');
  });

  it('HttpStatusError 409 → conflict', () => {
    expect(classifyUploadError(new HttpStatusError(409, 'dup')).kind).toBe('conflict');
  });

  it('HttpStatusError 422 → validation + 서버 메시지 보존', () => {
    const c = classifyUploadError(new HttpStatusError(422, '허용되지 않은 형식'));
    expect(c.kind).toBe('validation');
    expect(c.message).toBe('허용되지 않은 형식');
  });

  // CANDID-047 회귀 가드: 서버가 422를 빈/공백 message로 응답해도 빈 message를 반환하지 않는다.
  it('HttpStatusError 422 + 빈 message → validation + 폴백 메시지 (빈 문자열 금지)', () => {
    const c = classifyUploadError(new HttpStatusError(422, ''));
    expect(c.kind).toBe('validation');
    expect(c.message).toBe('파일이 허용된 형식·크기가 아닙니다.');
  });

  it('HttpStatusError 422 + 공백만 message → validation + 폴백 메시지', () => {
    const c = classifyUploadError(new HttpStatusError(422, '   '));
    expect(c.kind).toBe('validation');
    expect(c.message).toBe('파일이 허용된 형식·크기가 아닙니다.');
  });

  it('HttpStatusError 500 → server', () => {
    expect(classifyUploadError(new HttpStatusError(500, 'oops')).kind).toBe('server');
  });

  it('TimeoutError → network', () => {
    const err = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    expect(classifyUploadError(err).kind).toBe('network');
  });

  it('알 수 없는 에러 → network 기본', () => {
    expect(classifyUploadError(new Error('???')).kind).toBe('network');
    expect(classifyUploadError(null).kind).toBe('network');
  });
});

// A-MAJOR-2 (CANDID-040): dev-only 비정상 전이 경고.
describe('warnIfInvalidTransition (A-MAJOR-2)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function spyWarn() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
  }

  it('비정상 전이는 dev에서 console.warn (예: idle + upload-progress)', () => {
    const warn = spyWarn();
    warnIfInvalidTransition(INITIAL_UPLOAD_STATE, { type: 'upload-progress', progress: 50 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('예기치 않은 전이');
  });

  it('정상 전이는 경고 없음 (uploading + upload-progress)', () => {
    const warn = spyWarn();
    warnIfInvalidTransition({ ...INITIAL_UPLOAD_STATE, status: 'uploading' }, {
      type: 'upload-progress',
      progress: 10,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reset/select/abort는 모든 상태에서 허용 — 경고 없음', () => {
    const warn = spyWarn();
    warnIfInvalidTransition({ ...INITIAL_UPLOAD_STATE, status: 'clean' }, { type: 'reset' });
    warnIfInvalidTransition({ ...INITIAL_UPLOAD_STATE, status: 'infected' }, {
      type: 'select',
      file: sampleFile,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('failed/aborted + upload-start(재시도)는 허용 — 경고 없음', () => {
    const warn = spyWarn();
    warnIfInvalidTransition({ ...INITIAL_UPLOAD_STATE, status: 'failed' }, { type: 'upload-start' });
    warnIfInvalidTransition({ ...INITIAL_UPLOAD_STATE, status: 'aborted' }, { type: 'upload-start' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('production에서는 no-op (비정상 전이도 경고 안 함)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = spyWarn();
    warnIfInvalidTransition(INITIAL_UPLOAD_STATE, { type: 'upload-progress', progress: 50 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('순수성 유지 — reducer는 비정상 전이도 상태를 정상 처리(경고만)', () => {
    spyWarn();
    // idle에서 upload-progress: 경고하되 상태는 reducer 규칙대로 uploading+progress 처리.
    const next = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'upload-progress', progress: 42 });
    expect(next.status).toBe('uploading');
    expect(next.progress).toBe(42);
  });
});
