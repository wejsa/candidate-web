import { describe, expect, it } from 'vitest';
import {
  canAbort,
  canRetry,
  classifyUploadError,
  INITIAL_UPLOAD_STATE,
  uploadReducer,
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
