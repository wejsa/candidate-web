import { describe, expect, it } from 'vitest';
import {
  TRACE_HEADER,
  generateTraceId,
  normalizeTraceId,
  parseTraceparent,
  resolveIncomingTraceId,
} from '@/lib/observability/trace-header';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const W3C_TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const TRACEPARENT = `00-${W3C_TRACE_ID}-b7ad6b7169203331-01`;

describe('parseTraceparent', () => {
  it('extracts the 32-hex trace-id from a valid traceparent', () => {
    expect(parseTraceparent(TRACEPARENT)).toBe(W3C_TRACE_ID);
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(parseTraceparent(`  00-${W3C_TRACE_ID.toUpperCase()}-B7AD6B7169203331-01 `)).toBe(
      W3C_TRACE_ID,
    );
  });

  it('rejects an all-zero trace-id (W3C invalid)', () => {
    expect(parseTraceparent('00-00000000000000000000000000000000-b7ad6b7169203331-01')).toBeNull();
  });

  it.each([null, '', 'not-a-traceparent', '00-tooshort-b7ad6b7169203331-01'])(
    'returns null for malformed input %p',
    (value) => {
      expect(parseTraceparent(value)).toBeNull();
    },
  );
});

describe('normalizeTraceId', () => {
  it('accepts a UUID and a W3C trace-id verbatim', () => {
    const uuid = generateTraceId();
    expect(normalizeTraceId(uuid)).toBe(uuid);
    expect(normalizeTraceId(W3C_TRACE_ID)).toBe(W3C_TRACE_ID);
  });

  it('trims whitespace', () => {
    expect(normalizeTraceId('  trace-123  ')).toBe('trace-123');
  });

  it.each([
    ['empty', '   '],
    ['too long (>36)', 'x'.repeat(37)],
    ['control chars', 'trace\n123'],
    ['spaces inside', 'trace 123'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(normalizeTraceId(value as string | null | undefined)).toBeNull();
  });
});

describe('generateTraceId', () => {
  it('produces a UUID', () => {
    expect(generateTraceId()).toMatch(UUID_RE);
  });

  it('produces distinct ids', () => {
    expect(generateTraceId()).not.toBe(generateTraceId());
  });
});

describe('resolveIncomingTraceId', () => {
  const headerFn = (map: Record<string, string>) => (name: string) => map[name] ?? null;

  it('prefers x-trace-id over traceparent', () => {
    const resolved = resolveIncomingTraceId(
      headerFn({ [TRACE_HEADER]: 'self-propagated', traceparent: TRACEPARENT }),
    );
    expect(resolved).toBe('self-propagated');
  });

  it('falls back to traceparent when x-trace-id is absent', () => {
    expect(resolveIncomingTraceId(headerFn({ traceparent: TRACEPARENT }))).toBe(W3C_TRACE_ID);
  });

  it('falls back to traceparent when x-trace-id is malformed', () => {
    expect(
      resolveIncomingTraceId(headerFn({ [TRACE_HEADER]: 'bad id', traceparent: TRACEPARENT })),
    ).toBe(W3C_TRACE_ID);
  });

  it('returns null when no usable header is present (caller must generate)', () => {
    expect(resolveIncomingTraceId(headerFn({}))).toBeNull();
  });
});
