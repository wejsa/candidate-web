// CANDID-014 Step 3 — lib/auth/server-cookies 단위 테스트.
// next/headers cookies()와 verifyAccessToken을 mock해 RSC용 헬퍼만 단위 검증한다.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

const cookiesMock = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}));

vi.mock('@/lib/auth/jwt', () => ({
  verifyAccessToken: vi.fn(),
}));

const { verifyAccessToken } = (await import('@/lib/auth/jwt')) as unknown as {
  verifyAccessToken: Mock;
};
const { getOptionalAuthFromCookies } = await import('@/lib/auth/server-cookies');

function makeStore(value: string | undefined) {
  return {
    get: vi.fn((name: string) => {
      if (name === 'access_token' && value !== undefined) {
        return { name, value };
      }
      return undefined;
    }),
  };
}

beforeEach(() => {
  cookiesMock.mockReset();
  verifyAccessToken.mockReset();
});

describe('getOptionalAuthFromCookies', () => {
  it('access_token 쿠키 부재 → null + verifyAccessToken 호출 안 됨', async () => {
    cookiesMock.mockReturnValueOnce(makeStore(undefined));
    const result = await getOptionalAuthFromCookies();
    expect(result).toBeNull();
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('access_token 빈 문자열 → null + verifyAccessToken 호출 안 됨', async () => {
    cookiesMock.mockReturnValueOnce(makeStore(''));
    const result = await getOptionalAuthFromCookies();
    expect(result).toBeNull();
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('유효 토큰 → AuthContext { userId }', async () => {
    cookiesMock.mockReturnValueOnce(makeStore('valid-token'));
    verifyAccessToken.mockResolvedValueOnce({ ok: true, claims: { userId: 42 } });
    const result = await getOptionalAuthFromCookies();
    expect(result).toEqual({ userId: 42 });
    expect(verifyAccessToken).toHaveBeenCalledWith('valid-token');
  });

  it('만료 토큰 → null (verifyAccessToken ok=false)', async () => {
    cookiesMock.mockReturnValueOnce(makeStore('expired-token'));
    verifyAccessToken.mockResolvedValueOnce({ ok: false, reason: 'expired' });
    const result = await getOptionalAuthFromCookies();
    expect(result).toBeNull();
  });

  it('잘못된 서명 → null', async () => {
    cookiesMock.mockReturnValueOnce(makeStore('tampered'));
    verifyAccessToken.mockResolvedValueOnce({ ok: false, reason: 'invalid' });
    const result = await getOptionalAuthFromCookies();
    expect(result).toBeNull();
  });

  it('Next.js 15 호환 — cookies()가 Promise를 반환해도 await으로 처리', async () => {
    cookiesMock.mockReturnValueOnce(Promise.resolve(makeStore('valid-token')));
    verifyAccessToken.mockResolvedValueOnce({ ok: true, claims: { userId: 7 } });
    const result = await getOptionalAuthFromCookies();
    expect(result).toEqual({ userId: 7 });
  });
});
