import 'server-only';
import { Prisma } from '@prisma/client';
import { decryptPii, encryptPii } from '@/lib/crypto/aes-gcm';

// CANDID-008 — Prisma client extension.
// 읽기: result extension이 User.phone / User.birthDate를 자동 복호화 (Bytes → string).
// 쓰기: encryptUserPiiInput 헬퍼를 명시 호출하여 string → Bytes 변환 후 prisma에 전달.
//       (query extension은 args 타입을 Bytes로 고정하므로 string 입력은 타입 충돌.
//        명시 헬퍼가 더 안전한 패턴.)

/**
 * 현재 운영 중인 PII 암호화 키 버전. 키 회전 도입 시 마이그레이션을 거쳐 증가.
 * v1: env PII_ENCRYPTION_KEY 단일 키.
 */
export const PII_KEY_VERSION = 1;

function toBuffer(value: Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

// 명시적으로 export하여 단위 테스트가 piiExtension의 내부 구조에 의존하지 않도록 함.
// (Prisma.defineExtension의 반환 형태는 버전에 따라 wrap될 수 있음.)
export function computeDecryptedPhone(user: { phone: Uint8Array | null }): string | null {
  if (user.phone === null) return null;
  return decryptPii(toBuffer(user.phone));
}

export function computeDecryptedBirthDate(user: { birthDate: Uint8Array | null }): string | null {
  if (user.birthDate === null) return null;
  return decryptPii(toBuffer(user.birthDate));
}

/**
 * Prisma User 모델의 phone/birthDate 컬럼을 자동 복호화하는 result extension.
 *
 * 사용 예:
 *   const user = await prisma.user.findUnique({ where: { id } });
 *   // user.phone, user.birthDate 모두 평문 string (또는 null)로 반환됨.
 */
export const piiExtension = Prisma.defineExtension({
  name: 'pii-encryption',
  result: {
    user: {
      phone: {
        needs: { phone: true },
        compute: computeDecryptedPhone,
      },
      birthDate: {
        needs: { birthDate: true },
        compute: computeDecryptedBirthDate,
      },
    },
  },
});

export type UserPiiPlaintextInput = {
  phone?: string | null;
  birthDate?: string | null;
};

export type UserPiiEncryptedInput = {
  phone?: Buffer | null;
  phoneKeyVersion?: number;
  birthDate?: Buffer | null;
  birthDateKeyVersion?: number;
};

/**
 * 명시적 PII 입력 암호화 헬퍼. Route Handler에서 prisma.user.create/update 호출 직전에 사용.
 *
 *   await prisma.user.create({
 *     data: {
 *       email: 'foo@bar.com',
 *       name: 'foo',
 *       ...encryptUserPiiInput({ phone: '01012345678', birthDate: '1995-03-15' }),
 *     },
 *   });
 *
 * 입력 필드가 명시되지 않으면 결과에도 포함하지 않아 partial update를 지원한다.
 * null을 전달하면 컬럼을 NULL로 설정.
 */
export function encryptUserPiiInput(input: UserPiiPlaintextInput): UserPiiEncryptedInput {
  const result: UserPiiEncryptedInput = {};

  if ('phone' in input) {
    if (input.phone === null || input.phone === undefined) {
      result.phone = null;
    } else {
      result.phone = encryptPii(input.phone);
      result.phoneKeyVersion = PII_KEY_VERSION;
    }
  }

  if ('birthDate' in input) {
    if (input.birthDate === null || input.birthDate === undefined) {
      result.birthDate = null;
    } else {
      result.birthDate = encryptPii(input.birthDate);
      result.birthDateKeyVersion = PII_KEY_VERSION;
    }
  }

  return result;
}

/**
 * Raw query 등 $extends 우회 경로에서 단일 BYTEA → string 복호화에 사용.
 * 일반 prisma.user.findX 경로는 piiExtension이 자동 처리.
 */
export function decryptUserPiiField(value: Uint8Array | null): string | null {
  if (value === null) return null;
  return decryptPii(toBuffer(value));
}
