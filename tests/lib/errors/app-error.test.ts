import { describe, expect, it } from 'vitest';
import { AppError, isAppError } from '@/lib/errors/app-error';
import { ERROR_CATALOG } from '@/lib/errors/codes';

describe('AppError', () => {
  it('derives status and the default message from the catalog', () => {
    const err = new AppError('JOB_NOT_FOUND');
    expect(err.code).toBe('JOB_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.message).toBe(ERROR_CATALOG.JOB_NOT_FOUND.message);
    expect(err.details).toBeUndefined();
  });

  it('allows overriding the message while keeping the catalog status', () => {
    const err = new AppError('USER_NOT_FOUND', { message: '등록되지 않은 사용자입니다.' });
    expect(err.message).toBe('등록되지 않은 사용자입니다.');
    expect(err.code).toBe('USER_NOT_FOUND');
    expect(err.status).toBe(404);
  });

  // CANDID-007 Step 1 PR #25 리뷰 H003 — 빈/공백 override는 카탈로그 기본값으로 폴백.
  it('falls back to the catalog message for an empty or whitespace override', () => {
    expect(new AppError('JOB_NOT_FOUND', { message: '' }).message).toBe(
      ERROR_CATALOG.JOB_NOT_FOUND.message,
    );
    expect(new AppError('JOB_NOT_FOUND', { message: '   ' }).message).toBe(
      ERROR_CATALOG.JOB_NOT_FOUND.message,
    );
  });

  it('trims a message override', () => {
    expect(new AppError('USER_NOT_FOUND', { message: '  사용자 없음  ' }).message).toBe(
      '사용자 없음',
    );
  });

  it('carries field-level details', () => {
    const details = [{ field: 'email', reason: 'invalid format' }];
    const err = new AppError('SYS_VALIDATION_FAILED', { details });
    expect(err.details).toEqual(details);
    expect(err.status).toBe(400);
  });

  // CANDID-007 Step 1 PR #25 리뷰 H003 — details 빈 배열은 보존 (응답 생략은 errorResponse 책임).
  it('preserves an empty details array as-is', () => {
    const err = new AppError('SYS_VALIDATION_FAILED', { details: [] });
    expect(err.details).toEqual([]);
  });

  // CANDID-007 Step 1 PR #25 리뷰 H003 — cause는 unknown이므로 비-Error 값도 안전히 수용.
  it('accepts a non-Error cause without throwing', () => {
    expect(() => new AppError('SYS_INTERNAL_ERROR', { cause: 'raw string cause' })).not.toThrow();
    expect(new AppError('SYS_INTERNAL_ERROR', { cause: { db: 'timeout' } }).cause).toEqual({
      db: 'timeout',
    });
    expect(new AppError('SYS_INTERNAL_ERROR', { cause: null }).cause).toBeNull();
  });

  it('preserves the cause without exposing it in the message', () => {
    const cause = new Error('db connection timeout');
    const err = new AppError('SYS_DEPENDENCY_UNAVAILABLE', { cause });
    expect(err.cause).toBe(cause);
    expect(err.message).not.toContain('timeout');
  });

  it('is an instance of both Error and AppError', () => {
    const err = new AppError('AUTH_FORBIDDEN');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('AppError');
  });

  it('is throwable and catchable as AppError', () => {
    expect(() => {
      throw new AppError('AUTH_TOKEN_EXPIRED');
    }).toThrow(AppError);
  });
});

describe('isAppError', () => {
  it('returns true for an AppError instance', () => {
    expect(isAppError(new AppError('SYS_INTERNAL_ERROR'))).toBe(true);
  });

  it('returns false for a plain Error and non-error values', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError('AUTH_FORBIDDEN')).toBe(false);
    expect(isAppError({ code: 'AUTH_FORBIDDEN', status: 403 })).toBe(false);
  });
});
