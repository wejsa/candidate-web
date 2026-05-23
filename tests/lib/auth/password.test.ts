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

  it('H003/H006 fix — 72 bytes 정확(ASCII 72자)은 정상 처리', async () => {
    const plain = 'a'.repeat(72);
    const hash = await hashPassword(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
  });

  it('H003/H006 fix — UTF-8 72 bytes 초과(ASCII 73자)는 throw — bcrypt silent truncation 방지', async () => {
    await expect(hashPassword('a'.repeat(73))).rejects.toThrow(/72 bytes/);
  });

  it('H003/H006 fix — UTF-8 한글 24자(72 bytes)는 정상, 25자(75 bytes)는 throw', async () => {
    const ok = '가'.repeat(24);
    const hash = await hashPassword(ok);
    expect(await verifyPassword(ok, hash)).toBe(true);
    await expect(hashPassword('가'.repeat(25))).rejects.toThrow(/72 bytes/);
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
