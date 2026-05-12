import { describe, expect, it } from 'vitest';
import { decryptPii, encryptPii, IV_LENGTH, KEY_LENGTH, TAG_LENGTH } from '@/lib/crypto/aes-gcm';

const KEY_A = Buffer.alloc(KEY_LENGTH, 0xaa);
const KEY_B = Buffer.alloc(KEY_LENGTH, 0xbb);

describe('encryptPii / decryptPii — roundtrip', () => {
  it.each([
    ['ASCII phone', '01012345678'],
    ['Korean name', '홍길동'],
    ['empty string', ''],
    ['emoji', '👋 hello 안녕'],
    ['ISO date', '1995-03-15'],
  ])('roundtrips %s', (_label, plaintext) => {
    const ct = encryptPii(plaintext, KEY_A);
    expect(decryptPii(ct, KEY_A)).toBe(plaintext);
  });

  it('roundtrips 1KB payload', () => {
    const payload = 'A'.repeat(1024);
    const ct = encryptPii(payload, KEY_A);
    expect(decryptPii(ct, KEY_A)).toBe(payload);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const ct1 = encryptPii('hello', KEY_A);
    const ct2 = encryptPii('hello', KEY_A);
    expect(ct1.equals(ct2)).toBe(false);
  });

  it('output length = iv (12B) + tag (16B) + plaintext bytes', () => {
    const ct = encryptPii('hello', KEY_A);
    expect(ct.length).toBe(IV_LENGTH + TAG_LENGTH + 5);
  });
});

describe('decryptPii — tamper detection', () => {
  it('throws when auth tag is tampered', () => {
    const ct = encryptPii('hello', KEY_A);
    ct.writeUInt8(ct.readUInt8(IV_LENGTH) ^ 0xff, IV_LENGTH);
    expect(() => decryptPii(ct, KEY_A)).toThrow();
  });

  it('throws when iv is tampered', () => {
    const ct = encryptPii('hello', KEY_A);
    ct.writeUInt8(ct.readUInt8(0) ^ 0xff, 0);
    expect(() => decryptPii(ct, KEY_A)).toThrow();
  });

  it('throws when ciphertext byte is tampered', () => {
    const ct = encryptPii('hello-world-12345', KEY_A);
    const offset = IV_LENGTH + TAG_LENGTH;
    ct.writeUInt8(ct.readUInt8(offset) ^ 0xff, offset);
    expect(() => decryptPii(ct, KEY_A)).toThrow();
  });

  it('throws when ciphertext shorter than header', () => {
    expect(() => decryptPii(Buffer.alloc(IV_LENGTH + TAG_LENGTH - 1), KEY_A)).toThrow();
  });
});

describe('decryptPii — wrong key', () => {
  it('throws when decrypting with a different key', () => {
    const ct = encryptPii('secret', KEY_A);
    expect(() => decryptPii(ct, KEY_B)).toThrow();
  });
});

describe('key validation', () => {
  it('rejects key shorter than 32 bytes (encrypt)', () => {
    expect(() => encryptPii('x', Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it('rejects key shorter than 32 bytes (decrypt)', () => {
    const ct = encryptPii('x', KEY_A);
    expect(() => decryptPii(ct, Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe('default key from env', () => {
  it('uses PII_ENCRYPTION_KEY from process.env when no key provided', () => {
    // tests/setup.ts에서 PII_ENCRYPTION_KEY를 셋업했음.
    const ct = encryptPii('default-key-test');
    expect(decryptPii(ct)).toBe('default-key-test');
  });
});
