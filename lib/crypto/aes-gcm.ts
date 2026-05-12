import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// CANDID-008 — PII 컬럼 암호화 코어 모듈.
// 저장 포맷: [iv (12B)] || [authTag (16B)] || [ciphertext]  → 단일 BYTEA 컬럼.
// 키 소스: 환경 변수 PII_ENCRYPTION_KEY (64-char hex = 32 bytes).
// 키 회전 시: 새 키를 신규 _key_version으로 컬럼에 기록 (Step 2). 본 모듈은 v1 단일 키.

const ALGORITHM = 'aes-256-gcm' as const;
export const IV_LENGTH = 12; // GCM 권장 96-bit IV
export const TAG_LENGTH = 16; // GCM authentication tag
export const KEY_LENGTH = 32; // 256-bit key
const HEADER_LENGTH = IV_LENGTH + TAG_LENGTH;

let cachedKey: Buffer | undefined;

function getDefaultKey(): Buffer {
  if (cachedKey !== undefined) return cachedKey;
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('PII_ENCRYPTION_KEY environment variable is required (CANDID-008)');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('PII_ENCRYPTION_KEY must be 64-char hex (32 bytes)');
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

function validateKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AES key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
}

export function encryptPii(plaintext: string, key?: Buffer): Buffer {
  const k = key ?? getDefaultKey();
  validateKey(k);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptPii(packed: Buffer, key?: Buffer): string {
  if (packed.length < HEADER_LENGTH) {
    throw new Error(`PII ciphertext too short (${packed.length} < ${HEADER_LENGTH})`);
  }
  const k = key ?? getDefaultKey();
  validateKey(k);
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, HEADER_LENGTH);
  const ct = packed.subarray(HEADER_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
