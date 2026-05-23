import { describe, expect, it } from 'vitest';
import { generateTokenHex, sha256Hex } from '@/lib/auth/token-hash';

describe('generateTokenHex', () => {
  it('기본 32 bytes → 64-char hex', () => {
    const t = generateTokenHex();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('byte 수 지정 가능 (16 bytes → 32 hex)', () => {
    expect(generateTokenHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('호출마다 다른 값 (high-entropy)', () => {
    const a = generateTokenHex();
    const b = generateTokenHex();
    expect(a).not.toBe(b);
  });
});

describe('sha256Hex', () => {
  it('동일 입력은 동일 해시 (결정성)', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'));
  });

  it('다른 입력은 다른 해시', () => {
    expect(sha256Hex('hello')).not.toBe(sha256Hex('Hello'));
  });

  it('출력은 64-char hex', () => {
    expect(sha256Hex('any-input')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('빈 문자열도 처리 (RFC 6234 — e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855)', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('UTF-8 한글 일관 처리', () => {
    expect(sha256Hex('한국어')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('한국어')).toBe(sha256Hex('한국어'));
  });
});
