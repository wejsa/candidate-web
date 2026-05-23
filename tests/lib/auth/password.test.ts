import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

// BR-AUTH-02: BCrypt strength 12. 평문/해시 응답·로그 노출 금지.

describe('hashPassword', () => {
  it('strength 12 해시 prefix($2[ab]$12$) 반환', async () => {
    const hash = await hashPassword('CorrectHorse!23');
    expect(hash).toMatch(/^\$2[ab]\$12\$/);
    expect(hash.length).toBeGreaterThanOrEqual(60); // bcrypt 표준 길이
  });

  it('동일 평문이라도 매번 다른 salt → 다른 해시', async () => {
    const a = await hashPassword('Pa$$w0rd-test');
    const b = await hashPassword('Pa$$w0rd-test');
    expect(a).not.toBe(b);
  });

  it('빈 문자열 입력은 throw (방어적 가드)', async () => {
    await expect(hashPassword('')).rejects.toThrow(/empty/);
  });
});

describe('verifyPassword', () => {
  it('올바른 평문 + 해시는 true', async () => {
    const hash = await hashPassword('CorrectHorse!23');
    expect(await verifyPassword('CorrectHorse!23', hash)).toBe(true);
  });

  it('잘못된 평문 + 해시는 false', async () => {
    const hash = await hashPassword('CorrectHorse!23');
    expect(await verifyPassword('WrongPassword!23', hash)).toBe(false);
  });

  it.each([null, undefined, ''])('해시가 null/undefined/빈 문자열이면 false (throw 회피)', async (hash) => {
    expect(await verifyPassword('any', hash as string | null | undefined)).toBe(false);
  });

  it('해시 형식이 잘못되면 false (throw 회피)', async () => {
    expect(await verifyPassword('any', 'not-a-bcrypt-hash')).toBe(false);
  });
});
