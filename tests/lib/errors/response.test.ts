import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError, errorResponse, handleApiError, withErrorHandler } from '@/lib/errors';
import type { ErrorResponseBody } from '@/lib/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function req(path = '/api/v1/applications'): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

async function bodyOf(response: Response): Promise<ErrorResponseBody> {
  return (await response.json()) as ErrorResponseBody;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('errorResponse', () => {
  it('builds the standard 7-field body from a catalog code', async () => {
    const res = errorResponse(req('/api/v1/jobs/9'), 'JOB_NOT_FOUND');
    expect(res.status).toBe(404);
    const body = await bodyOf(res);
    expect(body.status).toBe(404);
    expect(body.code).toBe('JOB_NOT_FOUND');
    expect(body.message).toBe('채용 공고를 찾을 수 없습니다.');
    expect(body.path).toBe('/api/v1/jobs/9');
    expect(body.traceId).toMatch(UUID_RE);
    expect(typeof body.timestamp).toBe('string');
    expect(body.details).toBeUndefined();
  });

  it('omits details for an empty array', async () => {
    const body = await bodyOf(errorResponse(req(), 'SYS_VALIDATION_FAILED', { details: [] }));
    expect(body).not.toHaveProperty('details');
  });

  it('includes a non-empty details array', async () => {
    const details = [{ field: 'email', reason: 'required' }];
    const body = await bodyOf(errorResponse(req(), 'SYS_VALIDATION_FAILED', { details }));
    expect(body.details).toEqual(details);
  });

  it('falls back to the catalog message for an empty/whitespace override', async () => {
    const body = await bodyOf(errorResponse(req(), 'JOB_CLOSED', { message: '   ' }));
    expect(body.message).toBe('지원이 마감된 공고입니다.');
  });

  it('uses a provided traceId verbatim', async () => {
    const body = await bodyOf(errorResponse(req(), 'JOB_NOT_FOUND', { traceId: 'trace-xyz' }));
    expect(body.traceId).toBe('trace-xyz');
  });
});

describe('handleApiError', () => {
  it('maps an AppError to its catalog status/code/message', async () => {
    const res = handleApiError(new AppError('APP_DEADLINE_PASSED'), req(), 'tid-1');
    expect(res.status).toBe(422);
    const body = await bodyOf(res);
    expect(body.code).toBe('APP_DEADLINE_PASSED');
    expect(body.message).toBe('지원 마감일이 지난 공고입니다.');
    expect(body.traceId).toBe('tid-1');
  });

  it('carries AppError details through to the response', async () => {
    const err = new AppError('SYS_VALIDATION_FAILED', {
      details: [{ field: 'name', reason: 'too short' }],
    });
    const body = await bodyOf(handleApiError(err, req()));
    expect(body.details).toEqual([{ field: 'name', reason: 'too short' }]);
  });

  it('maps a ZodError to 400 SYS_VALIDATION_FAILED with field details', async () => {
    const parsed = z
      .object({ email: z.string().email(), age: z.number().int() })
      .safeParse({ email: 'bad', age: 1.5 });
    if (parsed.success) throw new Error('expected validation failure');

    const res = handleApiError(parsed.error, req('/api/v1/users'));
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.code).toBe('SYS_VALIDATION_FAILED');
    expect(body.details?.map((d) => d.field)).toEqual(expect.arrayContaining(['email', 'age']));
  });

  it('converges an unknown Error to 500 SYS_INTERNAL_ERROR', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = handleApiError(new Error('db socket closed'), req(), 'tid-2');
    expect(res.status).toBe(500);
    const body = await bodyOf(res);
    expect(body.code).toBe('SYS_INTERNAL_ERROR');
    expect(body.message).toBe('서버 내부 오류가 발생했습니다.');
  });

  it('does not leak the original error message in production', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    const body = await bodyOf(handleApiError(new Error('db host=10.0.0.5'), req()));
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });

  it('exposes a debug detail outside production', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = await bodyOf(handleApiError(new Error('boom'), req()));
    expect(body.details?.[0]?.field).toBe('(internal)');
    expect(body.details?.[0]?.reason).toContain('boom');
  });

  it('handles a non-Error throw value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = handleApiError('just a string', req());
    expect(res.status).toBe(500);
    expect((await bodyOf(res)).code).toBe('SYS_INTERNAL_ERROR');
  });

  it('logs unexpected errors to the server console with the traceId', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleApiError(new Error('boom'), req(), 'tid-log');
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]?.[0])).toContain('tid-log');
  });

  it('generates a uuid traceId when none is provided', async () => {
    const body = await bodyOf(handleApiError(new AppError('USER_NOT_FOUND'), req()));
    expect(body.traceId).toMatch(UUID_RE);
  });
});

describe('withErrorHandler', () => {
  it('passes a successful response through untouched', async () => {
    const handler = withErrorHandler(async () => NextResponse.json({ ok: true }));
    const res = await handler(req(), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('converts a thrown AppError into a standard error response', async () => {
    const handler = withErrorHandler(async () => {
      throw new AppError('AUTH_FORBIDDEN');
    });
    const res = await handler(req('/api/v1/me'), undefined);
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.code).toBe('AUTH_FORBIDDEN');
    expect(body.path).toBe('/api/v1/me');
  });

  it('converts an unexpected throw into a 500 SYS_INTERNAL_ERROR response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withErrorHandler(() => {
      throw new Error('internal boom');
    });
    const res = await handler(req(), undefined);
    expect(res.status).toBe(500);
    const body = await bodyOf(res);
    expect(body.code).toBe('SYS_INTERNAL_ERROR');
    expect(body.message).toBe('서버 내부 오류가 발생했습니다.');
  });
});
