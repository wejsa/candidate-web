import { afterEach, describe, expect, it } from 'vitest';
import { __resetCachedEnvForTesting } from '@/lib/env';
import {
  __resetCachedKeyForTesting,
  decryptPii,
  encryptPii,
  IV_LENGTH,
  KEY_LENGTH,
  TAG_LENGTH,
} from '@/lib/crypto/aes-gcm';

const KEY_A = Buffer.alloc(KEY_LENGTH, 0xaa);
const KEY_B = Buffer.alloc(KEY_LENGTH, 0xbb);

// H008 fix: 키 회전 테스트 케이스를 위해 매 테스트 후 캐시 초기화.
// CANDID-030 D3: env 캐시도 함께 초기화 — 키 회전 회귀 false-positive 차단.
afterEach(() => {
  __resetCachedKeyForTesting();
  __resetCachedEnvForTesting();
});

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
    const plaintext = 'hello';
    const ct = encryptPii(plaintext, KEY_A);
    expect(ct.length).toBe(IV_LENGTH + TAG_LENGTH + Buffer.byteLength(plaintext, 'utf8'));
  });
});

describe('decryptPii — tamper detection', () => {
  // H005 fix: 광범위한 toThrow() 대신 메시지 정규식 매칭으로 length-guard vs GCM-auth 실패 구분.
  it('throws auth failure when auth tag is tampered', () => {
    const ct = encryptPii('hello', KEY_A);
    ct.writeUInt8(ct.readUInt8(IV_LENGTH) ^ 0xff, IV_LENGTH);
    expect(() => decryptPii(ct, KEY_A)).toThrow(/authenticate|auth/i);
  });

  it('throws auth failure when iv is tampered', () => {
    const ct = encryptPii('hello', KEY_A);
    ct.writeUInt8(ct.readUInt8(0) ^ 0xff, 0);
    expect(() => decryptPii(ct, KEY_A)).toThrow(/authenticate|auth/i);
  });

  it('throws auth failure when ciphertext byte is tampered', () => {
    const ct = encryptPii('hello-world-12345', KEY_A);
    const offset = IV_LENGTH + TAG_LENGTH;
    ct.writeUInt8(ct.readUInt8(offset) ^ 0xff, offset);
    expect(() => decryptPii(ct, KEY_A)).toThrow(/authenticate|auth/i);
  });

  it('throws "too short" when ciphertext shorter than header', () => {
    expect(() => decryptPii(Buffer.alloc(IV_LENGTH + TAG_LENGTH - 1), KEY_A)).toThrow(/too short/);
  });

  it('accepts ciphertext exactly at header boundary (empty plaintext case)', () => {
    // header+0B 케이스: empty string 암호화의 정확한 출력. roundtrip로 검증.
    const ct = encryptPii('', KEY_A);
    expect(ct.length).toBe(IV_LENGTH + TAG_LENGTH);
    expect(decryptPii(ct, KEY_A)).toBe('');
  });
});

describe('decryptPii — wrong key', () => {
  it('throws auth failure when decrypting with a different key', () => {
    const ct = encryptPii('secret', KEY_A);
    expect(() => decryptPii(ct, KEY_B)).toThrow(/authenticate|auth/i);
  });
});

describe('key validation', () => {
  // M001 fix: 에러 메시지에서 실제 키 길이 제거 → "AES key length invalid" 고정.
  it.each([
    ['empty key (0B)', Buffer.alloc(0)],
    ['short key (16B)', Buffer.alloc(16)],
    ['off-by-one short (31B)', Buffer.alloc(31)],
    ['off-by-one long (33B)', Buffer.alloc(33)],
    ['double-length (64B)', Buffer.alloc(64)],
  ])('rejects %s on encrypt', (_label, badKey) => {
    expect(() => encryptPii('x', badKey)).toThrow(/AES key length invalid/);
  });

  it('rejects bad key on decrypt', () => {
    const ct = encryptPii('x', KEY_A);
    expect(() => decryptPii(ct, Buffer.alloc(16))).toThrow(/AES key length invalid/);
  });
});

describe('default key from env', () => {
  it('uses PII_ENCRYPTION_KEY from process.env when no key provided', () => {
    // tests/setup.ts에서 PII_ENCRYPTION_KEY를 셋업했음.
    const ct = encryptPii('default-key-test');
    expect(decryptPii(ct)).toBe('default-key-test');
  });
});
