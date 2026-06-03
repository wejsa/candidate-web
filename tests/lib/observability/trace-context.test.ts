import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  getTraceId,
  getTraceIdOrNew,
  runWithTrace,
  withTraceContext,
} from '@/lib/observability/trace-context';
import { TRACE_HEADER } from '@/lib/observability/trace-header';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('runWithTrace / getTraceId', () => {
  it('exposes the seeded traceId inside the callback', () => {
    const seen = runWithTrace('trace-abc', () => getTraceId());
    expect(seen).toBe('trace-abc');
  });

  it('generates a UUID when the seed is missing/invalid', () => {
    expect(runWithTrace(null, () => getTraceId())).toMatch(UUID_RE);
    expect(runWithTrace('bad id', () => getTraceId())).toMatch(UUID_RE);
  });

  it('propagates the context across await boundaries', async () => {
    const seen = await runWithTrace('trace-async', async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      return getTraceId();
    });
    expect(seen).toBe('trace-async');
  });

  it('isolates nested contexts and restores the outer one', () => {
    runWithTrace('outer', () => {
      expect(getTraceId()).toBe('outer');
      runWithTrace('inner', () => {
        expect(getTraceId()).toBe('inner');
      });
      expect(getTraceId()).toBe('outer');
    });
  });

  it('returns the callback result', () => {
    expect(runWithTrace('t', () => 42)).toBe(42);
  });
});

describe('getTraceId / getTraceIdOrNew outside a context', () => {
  it('getTraceId is undefined when no context is active', () => {
    expect(getTraceId()).toBeUndefined();
  });

  it('getTraceIdOrNew falls back to a fresh UUID outside a context', () => {
    expect(getTraceIdOrNew()).toMatch(UUID_RE);
  });

  it('getTraceIdOrNew returns the context traceId when active', () => {
    expect(runWithTrace('ctx-id', () => getTraceIdOrNew())).toBe('ctx-id');
  });
});

describe('withTraceContext (route wrapper)', () => {
  const req = (headers: Record<string, string> = {}) =>
    new NextRequest('http://localhost/api/v1/me', { headers });

  it('seeds the context from the x-trace-id header for the handler', async () => {
    let seen: string | undefined;
    const handler = withTraceContext(async () => {
      seen = getTraceId();
      return NextResponse.json({ ok: true });
    });
    await handler(req({ [TRACE_HEADER]: 'mw-trace' }), undefined);
    expect(seen).toBe('mw-trace');
  });

  it('keeps the context alive across awaits inside the handler', async () => {
    let seen: string | undefined;
    const handler = withTraceContext(async () => {
      await new Promise((r) => setTimeout(r, 0));
      seen = getTraceId();
      return NextResponse.json({ ok: true });
    });
    await handler(req({ [TRACE_HEADER]: 'async-trace' }), undefined);
    expect(seen).toBe('async-trace');
  });

  it('generates a traceId when the header is absent', async () => {
    let seen: string | undefined;
    const handler = withTraceContext(async () => {
      seen = getTraceId();
      return NextResponse.json({ ok: true });
    });
    await handler(req(), undefined);
    expect(seen).toMatch(UUID_RE);
  });

  it('does not leak the context after the handler resolves', async () => {
    const handler = withTraceContext(async () => NextResponse.json({ ok: true }));
    await handler(req({ [TRACE_HEADER]: 'scoped' }), undefined);
    expect(getTraceId()).toBeUndefined();
  });
});
