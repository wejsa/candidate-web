import { describe, expect, it } from 'vitest';
import { ERROR_CATALOG, errorMessage, errorStatus } from '@/lib/errors/codes';
import type { ErrorCode } from '@/lib/errors/codes';

const ALL_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];
const PREFIXES = ['AUTH_', 'USER_', 'JOB_', 'APP_', 'FILE_', 'SYS_'];
const VALID_STATUSES = new Set([400, 401, 403, 404, 409, 422, 429, 500, 503]);

describe('ERROR_CATALOG', () => {
  it('contains 22 codes', () => {
    expect(ALL_CODES).toHaveLength(22);
  });

  it('gives every code a known HTTP status and a non-empty message', () => {
    for (const code of ALL_CODES) {
      const spec = ERROR_CATALOG[code];
      expect(VALID_STATUSES.has(spec.status)).toBe(true);
      expect(spec.message.length).toBeGreaterThan(0);
    }
  });

  it('uses one of the six domain prefixes for every code', () => {
    for (const code of ALL_CODES) {
      expect(PREFIXES.some((prefix) => code.startsWith(prefix))).toBe(true);
    }
  });

  it('maps the four CANDID-006 auth token codes to 401', () => {
    expect(ERROR_CATALOG.AUTH_TOKEN_INVALID.status).toBe(401);
    expect(ERROR_CATALOG.AUTH_TOKEN_EXPIRED.status).toBe(401);
    expect(ERROR_CATALOG.AUTH_REFRESH_INVALID.status).toBe(401);
    expect(ERROR_CATALOG.AUTH_REFRESH_EXPIRED.status).toBe(401);
  });
});

describe('errorStatus / errorMessage', () => {
  it('returns the catalog status for a code', () => {
    expect(errorStatus('APP_DEADLINE_PASSED')).toBe(422);
    expect(errorStatus('SYS_INTERNAL_ERROR')).toBe(500);
    expect(errorStatus('SYS_DEPENDENCY_UNAVAILABLE')).toBe(503);
  });

  it('returns the catalog message for a code', () => {
    expect(errorMessage('JOB_CLOSED')).toBe(ERROR_CATALOG.JOB_CLOSED.message);
  });

  it('resolves every catalog code through both helpers', () => {
    for (const code of ALL_CODES) {
      expect(errorStatus(code)).toBe(ERROR_CATALOG[code].status);
      expect(errorMessage(code)).toBe(ERROR_CATALOG[code].message);
    }
  });
});
