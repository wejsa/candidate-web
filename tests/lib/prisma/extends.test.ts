import { describe, expect, it } from 'vitest';
import { encryptPii } from '@/lib/crypto/aes-gcm';
import {
  PII_KEY_VERSION,
  assertUserPiiInputShape,
  computeDecryptedBirthDate,
  computeDecryptedPhone,
  decryptUserPiiField,
  encryptPiiWithVersion,
  encryptUserPiiInput,
  normalizeBirthDate,
  normalizePhone,
  piiExtension,
} from '@/lib/prisma/extends';

describe('normalizePhone (CANDID-030 D4)', () => {
  it('strips hyphens and parens from 11-digit mobile', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('(010) 1234-5678')).toBe('01012345678');
  });

  it('passes through already-normalized digits', () => {
    expect(normalizePhone('01098765432')).toBe('01098765432');
  });

  it('throws on too-short input (< 9 digits)', () => {
    expect(() => normalizePhone('010')).toThrow(/9~11 digits/);
  });

  it('throws on too-long input (> 11 digits)', () => {
    expect(() => normalizePhone('+82-10-1234-5678')).toThrow(/9~11 digits/);
  });

  it('throws on empty string', () => {
    expect(() => normalizePhone('')).toThrow(/9~11 digits/);
  });
});

describe('normalizeBirthDate (CANDID-030 D4)', () => {
  it('accepts valid ISO date', () => {
    expect(normalizeBirthDate('1995-03-15')).toBe('1995-03-15');
  });

  it('accepts leap year 2000-02-29', () => {
    expect(normalizeBirthDate('2000-02-29')).toBe('2000-02-29');
  });

  it('throws on invalid month 1995-13-99', () => {
    expect(() => normalizeBirthDate('1995-13-99')).toThrow(/valid calendar date/);
  });

  it('throws on invalid day 2026-02-30', () => {
    expect(() => normalizeBirthDate('2026-02-30')).toThrow(/valid calendar date/);
  });

  it('throws on non-leap year 2023-02-29', () => {
    expect(() => normalizeBirthDate('2023-02-29')).toThrow(/valid calendar date/);
  });

  it('throws on format mismatch (datetime)', () => {
    expect(() => normalizeBirthDate('1995-03-15T00:00:00Z')).toThrow(/YYYY-MM-DD/);
  });

  it('throws on format mismatch (no zero-padding)', () => {
    expect(() => normalizeBirthDate('1995-3-15')).toThrow(/YYYY-MM-DD/);
  });
});

describe('encryptPiiWithVersion (CANDID-030 D2)', () => {
  it('returns ciphertext + keyVersion atomically', () => {
    const result = encryptPiiWithVersion('01012345678');
    expect(Buffer.isBuffer(result.ciphertext)).toBe(true);
    expect(result.keyVersion).toBe(PII_KEY_VERSION);
  });

  it('different invocations produce different ciphertext (random IV)', () => {
    const r1 = encryptPiiWithVersion('hello');
    const r2 = encryptPiiWithVersion('hello');
    expect(r1.ciphertext.equals(r2.ciphertext)).toBe(false);
    expect(r1.keyVersion).toBe(r2.keyVersion);
  });
});

describe('encryptUserPiiInput', () => {
  it('encrypts phone string into Buffer + sets keyVersion', () => {
    const result = encryptUserPiiInput({ phone: '01012345678' });
    expect(Buffer.isBuffer(result.phone)).toBe(true);
    expect(result.phoneKeyVersion).toBe(PII_KEY_VERSION);
  });

  it('normalizes phone with hyphens before encrypting', () => {
    const result = encryptUserPiiInput({ phone: '010-1234-5678' });
    expect(Buffer.isBuffer(result.phone)).toBe(true);
    // Verify the normalized form roundtrips correctly.
    if (result.phone instanceof Buffer) {
      expect(decryptUserPiiField(result.phone)).toBe('01012345678');
    }
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

  it('throws on invalid phone (too short)', () => {
    expect(() => encryptUserPiiInput({ phone: '010' })).toThrow(/9~11 digits/);
  });

  it('throws on invalid birthDate (1995-13-99)', () => {
    expect(() => encryptUserPiiInput({ birthDate: '1995-13-99' })).toThrow(/valid calendar date/);
  });

  it('throws on invalid birthDate (2023-02-29 non-leap)', () => {
    expect(() => encryptUserPiiInput({ birthDate: '2023-02-29' })).toThrow(/valid calendar date/);
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

describe('result extension compute functions (CANDID-030 D2 needs 확장)', () => {
  // 명시 export된 compute 함수를 직접 테스트.
  // compute 시그니처에 *_key_version 컬럼 needs 추가됨.
  it('computeDecryptedPhone decrypts with keyVersion', () => {
    const ct = encryptPii('01012345678');
    expect(computeDecryptedPhone({ phone: ct, phoneKeyVersion: 1 })).toBe('01012345678');
  });

  it('computeDecryptedPhone returns null for null phone (regardless of keyVersion)', () => {
    expect(computeDecryptedPhone({ phone: null, phoneKeyVersion: 1 })).toBeNull();
    expect(computeDecryptedPhone({ phone: null, phoneKeyVersion: null })).toBeNull();
  });

  it('computeDecryptedBirthDate decrypts with keyVersion', () => {
    const ct = encryptPii('1995-03-15');
    expect(computeDecryptedBirthDate({ birthDate: ct, birthDateKeyVersion: 1 })).toBe('1995-03-15');
  });

  it('computeDecryptedBirthDate returns null for null birthDate', () => {
    expect(computeDecryptedBirthDate({ birthDate: null, birthDateKeyVersion: 1 })).toBeNull();
    expect(computeDecryptedBirthDate({ birthDate: null, birthDateKeyVersion: null })).toBeNull();
  });

  it('piiExtension is exported (registered via prisma.$extends in lib/prisma.ts)', () => {
    expect(piiExtension).toBeDefined();
  });
});

describe('end-to-end: encrypt input → decrypt result roundtrip', () => {
  it('encryptUserPiiInput phone → decryptUserPiiField returns normalized plaintext', () => {
    const encoded = encryptUserPiiInput({ phone: '010-9876-5432' });
    expect(encoded.phone).toBeInstanceOf(Buffer);
    if (encoded.phone instanceof Buffer) {
      // 정규화된 결과 (디지트만) 반환.
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

// CANDID-031 D8 — write 런타임 가드. piiExtension.query.user의 모든 write op에서 호출되는
// assertUserPiiInputShape를 단위 테스트한다 (L-003: extension 내부 구조 의존 없이 함수 직접 호출).
describe('assertUserPiiInputShape (CANDID-031 D8)', () => {
  // 차단 케이스 — string 평문은 반드시 throw

  it('throws on string phone (raw plaintext)', () => {
    expect(() => assertUserPiiInputShape({ phone: '010-1234-5678' })).toThrow(
      /D8.*phone.*encryptUserPiiInput/,
    );
  });

  it('throws on string birthDate (raw plaintext)', () => {
    expect(() => assertUserPiiInputShape({ birthDate: '1995-03-15' })).toThrow(
      /D8.*birthDate.*encryptUserPiiInput/,
    );
  });

  it('throws on update wrapper { phone: { set: string } }', () => {
    expect(() => assertUserPiiInputShape({ phone: { set: '010-1234-5678' } })).toThrow(/D8.*phone/);
  });

  it('throws on update wrapper { birthDate: { set: string } }', () => {
    expect(() => assertUserPiiInputShape({ birthDate: { set: '1995-03-15' } })).toThrow(
      /D8.*birthDate/,
    );
  });

  // 통과 케이스 — 정상 입력은 throw 없음

  it('passes on Buffer phone (encrypted ciphertext)', () => {
    expect(() => assertUserPiiInputShape({ phone: Buffer.from([1, 2, 3]) })).not.toThrow();
  });

  it('passes on Uint8Array phone (encrypted ciphertext)', () => {
    expect(() => assertUserPiiInputShape({ phone: new Uint8Array([1, 2, 3]) })).not.toThrow();
  });

  it('passes on null phone (explicit NULL column set)', () => {
    expect(() => assertUserPiiInputShape({ phone: null })).not.toThrow();
  });

  it('passes on undefined phone (partial update)', () => {
    expect(() => assertUserPiiInputShape({ phone: undefined })).not.toThrow();
  });

  it('passes on wrapper { phone: { set: Buffer } } (update with ciphertext)', () => {
    expect(() => assertUserPiiInputShape({ phone: { set: Buffer.from([1, 2, 3]) } })).not.toThrow();
  });

  it('passes on input without phone/birthDate fields (non-PII update)', () => {
    expect(() => assertUserPiiInputShape({ name: '홍길동', email: 'foo@bar.com' })).not.toThrow();
  });

  it('passes on null / undefined / non-object input', () => {
    expect(() => assertUserPiiInputShape(null)).not.toThrow();
    expect(() => assertUserPiiInputShape(undefined)).not.toThrow();
    expect(() => assertUserPiiInputShape('string')).not.toThrow();
    expect(() => assertUserPiiInputShape(42)).not.toThrow();
  });

  it('passes on empty object', () => {
    expect(() => assertUserPiiInputShape({})).not.toThrow();
  });

  // encryptUserPiiInput 결과는 항상 통과해야 함 (회귀 가드)

  it('passes on encryptUserPiiInput output (production path regression guard)', () => {
    const encoded = encryptUserPiiInput({ phone: '010-1234-5678', birthDate: '1995-03-15' });
    expect(() => assertUserPiiInputShape(encoded)).not.toThrow();
  });

  // 에러 메시지에 actionable 안내가 포함되는가

  it('error message includes encryptUserPiiInput guidance', () => {
    try {
      assertUserPiiInputShape({ phone: '010-1234-5678' });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('encryptUserPiiInput');
      expect(msg).toContain('encryptPiiWithVersion');
    }
  });
});
