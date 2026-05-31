import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  createOAuthState,
  verifyOAuthStateCookie,
} from '@/lib/auth/oauth/state';
import { AppError } from '@/lib/errors';

// CANDID-012 Step 1 — state·PKCE 쿠키 헬퍼 단위 테스트.
//
// 검증 목표:
//   - createOAuthState round-trip이 정상 동작
//   - 모든 실패 경로가 단일 AUTH_OAUTH_STATE_INVALID로 수렴 (정보 누출 방지)
//   - 시간/서명/payload 모두 변조 detect
//
// timing 의존 케이스는 vi.useFakeTimers로 결정론적 검증.

describe('createOAuthState', () => {
  it('생성 결과의 state는 64자 hex 형식', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/jobs' });
    expect(r.state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('codeVerifier는 RFC 7636 §4.1 형식 (43~128자 unreserved)', () => {
    const r = createOAuthState({ provider: 'github', redirect: '/' });
    expect(r.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(r.codeVerifier.length).toBeLessThanOrEqual(128);
    expect(r.codeVerifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('codeChallenge는 SHA256(codeVerifier) base64url', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    const expected = createHash('sha256')
      .update(r.codeVerifier)
      .digest('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(r.codeChallenge).toBe(expected);
  });

  it('cookieValue는 "payload.signature" 형식', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/jobs' });
    const parts = r.cookieValue.split('.');
    expect(parts).toHaveLength(2);
    expect((parts[0] ?? '').length).toBeGreaterThan(0);
    expect((parts[1] ?? '').length).toBeGreaterThan(0);
  });

  it('cookieExpires는 현재 시각 +5분', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
    try {
      const r = createOAuthState({ provider: 'google', redirect: '/' });
      expect(r.cookieExpires.getTime()).toBe(Date.parse('2026-05-24T12:05:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('호출마다 state/verifier가 무작위 생성', () => {
    const a = createOAuthState({ provider: 'google', redirect: '/' });
    const b = createOAuthState({ provider: 'google', redirect: '/' });
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.cookieValue).not.toBe(b.cookieValue);
  });
});

describe('verifyOAuthStateCookie — happy path', () => {
  it('createOAuthState 산출물을 round-trip 복원', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/jobs?ref=hero' });
    const result = verifyOAuthStateCookie(r.cookieValue, r.state, 'google');
    expect(result.provider).toBe('google');
    expect(result.redirect).toBe('/jobs?ref=hero');
    expect(result.codeVerifier).toBe(r.codeVerifier);
  });

  it('github provider도 round-trip', () => {
    const r = createOAuthState({ provider: 'github', redirect: '/' });
    expect(verifyOAuthStateCookie(r.cookieValue, r.state, 'github').provider).toBe('github');
  });

  // CANDID-024 Step 5 — linkUserId 봉인/복원 (서명 페이로드, 위조 불가).
  it('linkUserId 설정 시 round-trip 복원', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/me/profile', linkUserId: 42 });
    expect(verifyOAuthStateCookie(r.cookieValue, r.state, 'google').linkUserId).toBe(42);
  });

  it('linkUserId 미설정 시 undefined', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    expect(verifyOAuthStateCookie(r.cookieValue, r.state, 'google').linkUserId).toBeUndefined();
  });
});

describe('verifyOAuthStateCookie — 실패 경로 (모두 AUTH_OAUTH_STATE_INVALID)', () => {
  function expectStateInvalid(fn: () => unknown): void {
    try {
      fn();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('AUTH_OAUTH_STATE_INVALID');
    }
  }

  it('쿠키 부재', () => {
    expectStateInvalid(() => verifyOAuthStateCookie(null, 'x', 'google'));
    expectStateInvalid(() => verifyOAuthStateCookie(undefined, 'x', 'google'));
    expectStateInvalid(() => verifyOAuthStateCookie('', 'x', 'google'));
  });

  it('queryState 부재', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    expectStateInvalid(() => verifyOAuthStateCookie(r.cookieValue, null, 'google'));
    expectStateInvalid(() => verifyOAuthStateCookie(r.cookieValue, '', 'google'));
  });

  it('쿠키 구조 위반 (점 누락)', () => {
    expectStateInvalid(() => verifyOAuthStateCookie('no-dot-here', 'x', 'google'));
    expectStateInvalid(() => verifyOAuthStateCookie('a.b.c', 'x', 'google'));
  });

  it('서명 위조 (signature 변조)', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    const [payload] = r.cookieValue.split('.');
    expectStateInvalid(() =>
      verifyOAuthStateCookie(`${payload}.tampered_signature_xyz`, r.state, 'google'),
    );
  });

  it('payload 위조 (서명 일치 안 함)', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    const [, sig] = r.cookieValue.split('.');
    // payload를 새로 만들어 signature와 mismatch
    const fakePayload = Buffer.from(
      JSON.stringify({
        p: 'google',
        r: '/evil',
        v: 'x',
        s: r.state,
        n: 'n',
        e: Date.now() + 60000,
      }),
      'utf8',
    )
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expectStateInvalid(() => verifyOAuthStateCookie(`${fakePayload}.${sig}`, r.state, 'google'));
  });

  it('만료 (TTL 초과)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
    try {
      const r = createOAuthState({ provider: 'google', redirect: '/' });
      // 5분 1초 후로 이동
      vi.setSystemTime(new Date('2026-05-24T12:05:01Z'));
      expectStateInvalid(() => verifyOAuthStateCookie(r.cookieValue, r.state, 'google'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('만료 경계 정확 5분 시점에 차단', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
    try {
      const r = createOAuthState({ provider: 'google', redirect: '/' });
      // 정확히 만료 시각: now >= exp 차단
      vi.setSystemTime(new Date('2026-05-24T12:05:00Z'));
      expectStateInvalid(() => verifyOAuthStateCookie(r.cookieValue, r.state, 'google'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('state 불일치 (다른 쿼리 state)', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    const otherState = '0'.repeat(64);
    expectStateInvalid(() => verifyOAuthStateCookie(r.cookieValue, otherState, 'google'));
  });

  it('state 길이 불일치 (timing-safe 가드)', () => {
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    expectStateInvalid(() => verifyOAuthStateCookie(r.cookieValue, 'short', 'google'));
  });

  it('URL provider 불일치 (콜백 경로 위조)', () => {
    // 사용자가 google로 시작했는데 callback 경로는 github로 위조된 경우 차단
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    expectStateInvalid(() => verifyOAuthStateCookie(r.cookieValue, r.state, 'github'));
  });

  it('알 수 없는 provider (payload에 임의 값)', () => {
    // 다른 키로 서명한 쿠키는 만들 수 없으므로 — 정상 쿠키 후 base64 payload를 surgical하게 바꿔
    // payload validation 자체가 catch하도록 검증
    const r = createOAuthState({ provider: 'google', redirect: '/' });
    // 변조된 쿠키는 서명 검증에서 이미 차단되므로 본 케이스는 사실상 (5)서명검증으로 수렴.
    // 직접 verify를 통과시키지 않고 동작만 확인.
    expectStateInvalid(() => verifyOAuthStateCookie(r.cookieValue, r.state, 'unknown-provider'));
  });
});

describe('상수 export', () => {
  it('OAUTH_STATE_COOKIE 이름 안정성', () => {
    expect(OAUTH_STATE_COOKIE).toBe('oauth_state');
  });

  it('OAUTH_STATE_COOKIE_PATH는 OAuth 라우트 prefix와 정합', () => {
    expect(OAUTH_STATE_COOKIE_PATH).toBe('/api/v1/auth/oauth');
  });
});

describe('서명 키 namespace 격리', () => {
  it('JWT_ACCESS_SECRET이 바뀌면 기존 쿠키 검증 실패', async () => {
    const r = createOAuthState({ provider: 'google', redirect: '/' });

    const originalSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET =
      'rotated-access-secret-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX-only';
    // env 캐시 리셋 — getEnv 캐시가 활성이면 회전 반영 안 됨
    const env = await import('@/lib/env');
    env.__resetCachedEnvForTesting();

    try {
      try {
        verifyOAuthStateCookie(r.cookieValue, r.state, 'google');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('AUTH_OAUTH_STATE_INVALID');
      }
    } finally {
      process.env.JWT_ACCESS_SECRET = originalSecret;
      env.__resetCachedEnvForTesting();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
