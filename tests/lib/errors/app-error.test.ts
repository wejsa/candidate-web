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
    const err = new AppError('USER_NOT_FOUND', { message: 'ID 42 사용자가 없습니다.' });
    expect(err.message).toBe('ID 42 사용자가 없습니다.');
    expect(err.code).toBe('USER_NOT_FOUND');
    expect(err.status).toBe(404);
  });

  it('carries field-level details', () => {
    const details = [{ field: 'email', reason: 'invalid format' }];
    const err = new AppError('SYS_VALIDATION_FAILED', { details });
    expect(err.details).toEqual(details);
    expect(err.status).toBe(400);
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
