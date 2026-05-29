import { describe, expect, it } from 'vitest';
import { ERROR_CATALOG, errorMessage, errorStatus } from '@/lib/errors/codes';
import type { ErrorCode } from '@/lib/errors/codes';

const ALL_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];
const PREFIXES = ['AUTH_', 'USER_', 'JOB_', 'APP_', 'FILE_', 'SYS_'];
const VALID_STATUSES = new Set([400, 401, 403, 404, 409, 410, 422, 429, 500, 502, 503]);

describe('ERROR_CATALOG', () => {
  it('contains 41 codes', () => {
    // CANDID-009 Step 2: SYS_RATE_LIMITED, SYS_FORBIDDEN_ORIGIN 추가로 22 → 24
    // CANDID-010 Step 3: AUTH_VERIFICATION_TOKEN_INVALID/EXPIRED/RESEND_COOLDOWN 추가로 24 → 27
    // CANDID-037 Step 2: AUTH_EMAIL_ALREADY_VERIFIED 추가로 27 → 28
    // CANDID-012 Step 1: AUTH_OAUTH_STATE_INVALID/PROVIDER_ERROR/EMAIL_TAKEN/USER_DENIED 추가로 28 → 32
    // CANDID-015 Step 1: APP_USER_UNDER_MIN_AGE 추가로 32 → 33 (BR-PII-05)
    // CANDID-016 Step 2: FILE_ALREADY_EXISTS, FILE_NOT_FOUND 추가로 33 → 35
    // CANDID-017 Step 1: APP_DRAFT_NOT_FOUND 추가로 35 → 36 (US-APP-004 portfolio 권한+미존재 통합)
    // CANDID-018 Step 1: APP_SUBMIT_INCOMPLETE 추가로 36 → 37 (US-APP-006 제출 전 검증)
    // CANDID-019 Step 2 review C1: APP_INTERVIEW_NOT_FOUND 추가로 37 → 38 (US-MY-002 .ics 시맨틱 분리)
    // CANDID-022 Step 1: USER_ALREADY_WITHDRAWN, USER_PASSWORD_RECONFIRM_REQUIRED, USER_REAUTH_REQUIRED 추가로 38 → 41 (US-AUTH-005)
    // CANDID-020 Step 2: AUTH_RESET_TOKEN_INVALID, AUTH_RESET_TOKEN_EXPIRED 추가로 41 → 43 (US-AUTH-004)
    expect(ALL_CODES).toHaveLength(43);
  });

  it('CANDID-020 신규 코드: AUTH_RESET_TOKEN_INVALID=400, AUTH_RESET_TOKEN_EXPIRED=410', () => {
    expect(ERROR_CATALOG.AUTH_RESET_TOKEN_INVALID.status).toBe(400);
    expect(ERROR_CATALOG.AUTH_RESET_TOKEN_EXPIRED.status).toBe(410);
    expect(errorMessage('AUTH_RESET_TOKEN_INVALID')).toMatch(/유효하지 않은|재설정/);
    expect(errorMessage('AUTH_RESET_TOKEN_EXPIRED')).toMatch(/만료/);
  });

  it('CANDID-022 Step 1 신규 코드: USER_ALREADY_WITHDRAWN=409, USER_PASSWORD_RECONFIRM_REQUIRED=422, USER_REAUTH_REQUIRED=422', () => {
    expect(ERROR_CATALOG.USER_ALREADY_WITHDRAWN.status).toBe(409);
    expect(ERROR_CATALOG.USER_PASSWORD_RECONFIRM_REQUIRED.status).toBe(422);
    expect(ERROR_CATALOG.USER_REAUTH_REQUIRED.status).toBe(422);
    expect(errorMessage('USER_ALREADY_WITHDRAWN')).toMatch(/이미 탈퇴/);
    expect(errorMessage('USER_PASSWORD_RECONFIRM_REQUIRED')).toMatch(/비밀번호/);
    expect(errorMessage('USER_REAUTH_REQUIRED')).toMatch(/소셜|재인증/);
  });

  it('CANDID-016 Step 2 신규 코드: FILE_ALREADY_EXISTS=409, FILE_NOT_FOUND=404', () => {
    expect(ERROR_CATALOG.FILE_ALREADY_EXISTS.status).toBe(409);
    expect(ERROR_CATALOG.FILE_NOT_FOUND.status).toBe(404);
    expect(errorMessage('FILE_ALREADY_EXISTS')).toMatch(/이미 첨부/);
    expect(errorMessage('FILE_NOT_FOUND')).toMatch(/찾을 수 없습니다/);
  });

  it('CANDID-012 Step 1 신규 코드: AUTH_OAUTH_STATE_INVALID=400, _PROVIDER_ERROR=502, _EMAIL_TAKEN=409, _USER_DENIED=422', () => {
    expect(ERROR_CATALOG.AUTH_OAUTH_STATE_INVALID.status).toBe(400);
    expect(ERROR_CATALOG.AUTH_OAUTH_PROVIDER_ERROR.status).toBe(502);
    expect(ERROR_CATALOG.AUTH_OAUTH_EMAIL_TAKEN.status).toBe(409);
    // _USER_DENIED=422 — 사용자 명시적 거부는 비즈니스 분기(processable but rejected) (review fix)
    expect(ERROR_CATALOG.AUTH_OAUTH_USER_DENIED.status).toBe(422);
    expect(errorMessage('AUTH_OAUTH_STATE_INVALID')).toMatch(/만료|변조/);
    expect(errorMessage('AUTH_OAUTH_PROVIDER_ERROR')).toMatch(/제공자|통신/);
    expect(errorMessage('AUTH_OAUTH_EMAIL_TAKEN')).toMatch(/이미 가입된 이메일/);
    expect(errorMessage('AUTH_OAUTH_USER_DENIED')).toMatch(/권한 요청|거부/);
  });

  it('CANDID-010 Step 3 신규 코드: AUTH_VERIFICATION_TOKEN_INVALID=400, _EXPIRED=410, _RESEND_COOLDOWN=429', () => {
    expect(ERROR_CATALOG.AUTH_VERIFICATION_TOKEN_INVALID.status).toBe(400);
    expect(ERROR_CATALOG.AUTH_VERIFICATION_TOKEN_EXPIRED.status).toBe(410);
    expect(ERROR_CATALOG.AUTH_VERIFICATION_RESEND_COOLDOWN.status).toBe(429);
    expect(errorMessage('AUTH_VERIFICATION_TOKEN_INVALID')).toMatch(/유효하지 않은/);
    expect(errorMessage('AUTH_VERIFICATION_TOKEN_EXPIRED')).toMatch(/만료/);
    expect(errorMessage('AUTH_VERIFICATION_RESEND_COOLDOWN')).toMatch(/60초/);
  });

  it('CANDID-009 신규 코드: SYS_RATE_LIMITED=429, SYS_FORBIDDEN_ORIGIN=403', () => {
    expect(ERROR_CATALOG.SYS_RATE_LIMITED.status).toBe(429);
    expect(ERROR_CATALOG.SYS_FORBIDDEN_ORIGIN.status).toBe(403);
    expect(errorMessage('SYS_RATE_LIMITED')).toMatch(/요청이 너무 많/);
    expect(errorMessage('SYS_FORBIDDEN_ORIGIN')).toMatch(/허용되지 않은 출처/);
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

  // CANDID-007 Step 1 PR #25 리뷰 H002 — 코드별 status를 1:1로 고정해 동일군 내 오변경 회귀를 차단.
  // EXPECTED_STATUS는 Record<ErrorCode, number>라 코드 추가/삭제 시 컴파일 단계에서 동기화가 강제된다.
  it('maps every code to its exact intended HTTP status', () => {
    const EXPECTED_STATUS: Record<ErrorCode, number> = {
      AUTH_INVALID_CREDENTIALS: 401,
      AUTH_ACCOUNT_LOCKED: 429,
      AUTH_EMAIL_NOT_VERIFIED: 403,
      AUTH_TOKEN_INVALID: 401,
      AUTH_TOKEN_EXPIRED: 401,
      AUTH_REFRESH_INVALID: 401,
      AUTH_REFRESH_EXPIRED: 401,
      AUTH_FORBIDDEN: 403,
      USER_EMAIL_DUPLICATED: 409,
      USER_NOT_FOUND: 404,
      JOB_NOT_FOUND: 404,
      JOB_NOT_OPEN: 422,
      JOB_CLOSED: 422,
      APP_ALREADY_SUBMITTED: 409,
      APP_DEADLINE_PASSED: 422,
      APP_DRAFT_CONFLICT: 409,
      FILE_SIZE_EXCEEDED: 422,
      FILE_TYPE_NOT_ALLOWED: 422,
      FILE_UPLOAD_FAILED: 500,
      FILE_ALREADY_EXISTS: 409,
      FILE_NOT_FOUND: 404,
      SYS_INTERNAL_ERROR: 500,
      SYS_DEPENDENCY_UNAVAILABLE: 503,
      SYS_VALIDATION_FAILED: 400,
      SYS_RATE_LIMITED: 429,
      SYS_FORBIDDEN_ORIGIN: 403,
      AUTH_VERIFICATION_TOKEN_INVALID: 400,
      AUTH_VERIFICATION_TOKEN_EXPIRED: 410,
      AUTH_VERIFICATION_RESEND_COOLDOWN: 429,
      AUTH_EMAIL_ALREADY_VERIFIED: 409,
      AUTH_RESET_TOKEN_INVALID: 400,
      AUTH_RESET_TOKEN_EXPIRED: 410,
      AUTH_OAUTH_STATE_INVALID: 400,
      AUTH_OAUTH_PROVIDER_ERROR: 502,
      AUTH_OAUTH_EMAIL_TAKEN: 409,
      AUTH_OAUTH_USER_DENIED: 422,
      APP_USER_UNDER_MIN_AGE: 422,
      APP_DRAFT_NOT_FOUND: 404,
      APP_SUBMIT_INCOMPLETE: 422,
      APP_INTERVIEW_NOT_FOUND: 404,
      USER_ALREADY_WITHDRAWN: 409,
      USER_PASSWORD_RECONFIRM_REQUIRED: 422,
      USER_REAUTH_REQUIRED: 422,
    };
    for (const code of ALL_CODES) {
      expect(ERROR_CATALOG[code].status).toBe(EXPECTED_STATUS[code]);
    }
  });

  // CANDID-007 Step 1 PR #25 리뷰 M005 — 키 형식을 UPPER_SNAKE로 엄격 검증 (startsWith 보강).
  it('uses a strict UPPER_SNAKE format for every code key', () => {
    for (const code of ALL_CODES) {
      expect(code).toMatch(/^(AUTH|USER|JOB|APP|FILE|SYS)_[A-Z]+(_[A-Z]+)*$/);
    }
  });

  // CANDID-007 Step 1 PR #25 리뷰 M004 — 메시지 중복(붙여넣기 실수)을 회귀로 차단.
  it('gives every code a unique message', () => {
    const messages = ALL_CODES.map((code) => ERROR_CATALOG[code].message);
    expect(new Set(messages).size).toBe(ALL_CODES.length);
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
