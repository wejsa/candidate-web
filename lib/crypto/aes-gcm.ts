import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';

// CANDID-008 — PII 컬럼 암호화 코어 모듈.
// 저장 포맷: [iv (12B)] || [authTag (16B)] || [ciphertext]  → 단일 BYTEA 컬럼.
// 키 소스: env.ts의 zod 검증 통과한 PII_ENCRYPTION_KEY (단일 진입점 — H001 fix).
// 키 회전: User.phone_key_version / birth_date_key_version 컬럼이 키 버전 추적.
//          v1은 본 모듈의 기본 키, v2 도입 시 별도 key-provider로 분기.

const ALGORITHM = 'aes-256-gcm' as const;
export const IV_LENGTH = 12; // GCM 권장 96-bit IV
export const TAG_LENGTH = 16; // GCM authentication tag
export const KEY_LENGTH = 32; // 256-bit key
const HEADER_LENGTH = IV_LENGTH + TAG_LENGTH;

let cachedKey: Buffer | undefined;

function getDefaultKey(): Buffer {
  if (cachedKey !== undefined) return cachedKey;
  // env.ts에서 zod로 형식 검증 통과한 값만 도달 — 본 함수는 hex→Buffer 변환 책임만.
  const hex = getEnv().PII_ENCRYPTION_KEY;
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

function validateKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    // 길이 정보는 노출하지 않음 (M001 fix — 보안 메타데이터 최소화).
    throw new Error('AES key length invalid');
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
    throw new Error('PII ciphertext too short');
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

/**
 * 테스트 전용 — `getEnv()` 캐시와 본 모듈의 키 캐시를 무효화.
 * 키 회전 또는 env 변경 테스트에서 사용 (H008 fix).
 * @internal
 */
export function __resetCachedKeyForTesting(): void {
  cachedKey = undefined;
}
