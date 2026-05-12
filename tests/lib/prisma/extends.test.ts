import { describe, expect, it } from 'vitest';
import { encryptPii } from '@/lib/crypto/aes-gcm';
import {
  PII_KEY_VERSION,
  computeDecryptedBirthDate,
  computeDecryptedPhone,
  decryptUserPiiField,
  encryptUserPiiInput,
  piiExtension,
} from '@/lib/prisma/extends';

describe('encryptUserPiiInput', () => {
  it('encrypts phone string into Buffer + sets keyVersion', () => {
    const result = encryptUserPiiInput({ phone: '01012345678' });
    expect(Buffer.isBuffer(result.phone)).toBe(true);
    expect(result.phoneKeyVersion).toBe(PII_KEY_VERSION);
  });

  it('encrypts birthDate string into Buffer + sets keyVersion', () => {
    const result = encryptUserPiiInput({ birthDate: '1995-03-15' });
    expect(Buffer.isBuffer(result.birthDate)).toBe(true);
    expect(result.birthDateKeyVersion).toBe(PII_KEY_VERSION);
  });

  it('preserves null phone without setting keyVersion', () => {
    const result = encryptUserPiiInput({ phone: null });
    expect(result.phone).toBeNull();
    expect(result.phoneKeyVersion).toBeUndefined();
  });

  it('preserves null birthDate without setting keyVersion', () => {
    const result = encryptUserPiiInput({ birthDate: null });
    expect(result.birthDate).toBeNull();
    expect(result.birthDateKeyVersion).toBeUndefined();
  });

  it('returns empty object when neither field present (partial update)', () => {
    const result = encryptUserPiiInput({});
    expect(result).toEqual({});
  });

  it('handles both fields together', () => {
    const result = encryptUserPiiInput({ phone: '01098765432', birthDate: '2000-02-29' });
    expect(Buffer.isBuffer(result.phone)).toBe(true);
    expect(Buffer.isBuffer(result.birthDate)).toBe(true);
    expect(result.phoneKeyVersion).toBe(PII_KEY_VERSION);
    expect(result.birthDateKeyVersion).toBe(PII_KEY_VERSION);
  });
});

describe('decryptUserPiiField', () => {
  it('decrypts encrypted Buffer back to plaintext', () => {
    const ct = encryptPii('01012345678');
    expect(decryptUserPiiField(ct)).toBe('01012345678');
  });

  it('returns null for null input', () => {
    expect(decryptUserPiiField(null)).toBeNull();
  });

  it('accepts Uint8Array (Prisma may return non-Buffer in some drivers)', () => {
    const ct = encryptPii('test-value');
    const u8 = new Uint8Array(ct);
    expect(decryptUserPiiField(u8)).toBe('test-value');
  });
});

describe('result extension compute functions', () => {
  // piiExtension 내부 구조(Prisma defineExtension wrap)에 의존하지 않고,
  // 명시 export된 compute 함수를 직접 테스트.
  it('computeDecryptedPhone decrypts encrypted Buffer to plaintext', () => {
    const ct = encryptPii('01012345678');
    expect(computeDecryptedPhone({ phone: ct })).toBe('01012345678');
  });

  it('computeDecryptedPhone returns null for null phone', () => {
    expect(computeDecryptedPhone({ phone: null })).toBeNull();
  });

  it('computeDecryptedBirthDate decrypts encrypted Buffer to plaintext', () => {
    const ct = encryptPii('1995-03-15');
    expect(computeDecryptedBirthDate({ birthDate: ct })).toBe('1995-03-15');
  });

  it('computeDecryptedBirthDate returns null for null birthDate', () => {
    expect(computeDecryptedBirthDate({ birthDate: null })).toBeNull();
  });

  it('piiExtension is exported (registered via prisma.$extends in lib/prisma.ts)', () => {
    expect(piiExtension).toBeDefined();
  });
});

describe('end-to-end: encrypt input → decrypt result roundtrip', () => {
  it('encryptUserPiiInput phone → decryptUserPiiField returns original plaintext', () => {
    const encoded = encryptUserPiiInput({ phone: '01098765432' });
    expect(encoded.phone).toBeInstanceOf(Buffer);
    if (encoded.phone instanceof Buffer) {
      expect(decryptUserPiiField(encoded.phone)).toBe('01098765432');
    }
  });

  it('encryptUserPiiInput birthDate → decryptUserPiiField returns original plaintext', () => {
    const encoded = encryptUserPiiInput({ birthDate: '2000-02-29' });
    expect(encoded.birthDate).toBeInstanceOf(Buffer);
    if (encoded.birthDate instanceof Buffer) {
      expect(decryptUserPiiField(encoded.birthDate)).toBe('2000-02-29');
    }
  });
});
