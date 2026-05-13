import 'server-only';
import { Prisma } from '@prisma/client';
import { decryptPii, encryptPii } from '@/lib/crypto/aes-gcm';

// CANDID-008 — Prisma client extension. CANDID-030 (FU1)에서 보강.
// 읽기: result extension이 User.phone / User.birthDate를 자동 복호화 (Bytes → string).
//       phone_key_version / birth_date_key_version 컬럼도 needs에 포함 — 향후 v2 키 분기 준비.
// 쓰기: encryptUserPiiInput 헬퍼를 명시 호출. 내부에서 입력 정규화(D4) + 키 버전 atomic 결합(D2).

/**
 * 현재 운영 중인 PII 암호화 키 버전. v2 도입 시 별도 key-provider 모듈로 분기.
 * v1: env PII_ENCRYPTION_KEY 단일 키.
 */
export const PII_KEY_VERSION = 1;

function toBuffer(value: Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

/**
 * D2: ciphertext와 keyVersion을 atomic 반환 — 키 회전 race 차단.
 * 호출자가 두 값을 별도 set하는 경로(키 swap 시점 차이)를 원천 차단한다.
 * 본 wrapper는 encryptUserPiiInput 내부에서 사용하지만, raw query 등 우회 경로에서도 활용 가능.
 */
export function encryptPiiWithVersion(plaintext: string): {
  ciphertext: Buffer;
  keyVersion: number;
} {
  return {
    ciphertext: encryptPii(plaintext),
    keyVersion: PII_KEY_VERSION,
  };
}

// 명시 export하여 단위 테스트가 piiExtension의 내부 구조에 의존하지 않도록 함.
// CANDID-030 (D2): keyVersion 컬럼을 needs에 추가했으므로 compute 시그니처도 함께 확장.
// v1은 단일 키 — v1이 아닌 row를 만나면 GCM auth 실패로 자연 차단.
export function computeDecryptedPhone(user: {
  phone: Uint8Array | null;
  phoneKeyVersion: number | null;
}): string | null {
  if (user.phone === null) return null;
  // 향후 v2 도입 시 user.phoneKeyVersion 기반 keyResolver로 분기.
  return decryptPii(toBuffer(user.phone));
}

export function computeDecryptedBirthDate(user: {
  birthDate: Uint8Array | null;
  birthDateKeyVersion: number | null;
}): string | null {
  if (user.birthDate === null) return null;
  return decryptPii(toBuffer(user.birthDate));
}

/**
 * Prisma User 모델의 phone/birthDate 컬럼을 자동 복호화하는 result extension.
 * needs에 *_key_version 컬럼을 포함하여 키 회전 분기 시 시그니처 안정성 보장.
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
        needs: { phone: true, phoneKeyVersion: true },
        compute: computeDecryptedPhone,
      },
      birthDate: {
        needs: { birthDate: true, birthDateKeyVersion: true },
        compute: computeDecryptedBirthDate,
      },
    },
  },
  // CANDID-031 (D8) — write 런타임 가드. assertUserPiiInputShape를 모든 User write op에 적용.
  // string 평문 phone/birthDate 입력 시 throw → encryptUserPiiInput 헬퍼 누락 차단.
  query: {
    user: {
      async create({ args, query }) {
        assertUserPiiInputShape(args.data);
        return query(args);
      },
      async update({ args, query }) {
        assertUserPiiInputShape(args.data);
        return query(args);
      },
      async upsert({ args, query }) {
        assertUserPiiInputShape(args.create);
        assertUserPiiInputShape(args.update);
        return query(args);
      },
      async updateMany({ args, query }) {
        assertUserPiiInputShape(args.data);
        return query(args);
      },
      async createMany({ args, query }) {
        const dataArr = Array.isArray(args.data) ? args.data : [args.data];
        for (const row of dataArr) {
          assertUserPiiInputShape(row);
        }
        return query(args);
      },
    },
  },
});

/**
 * D4: 전화번호 정규화 — 숫자만 추출하여 9~11자리 검증. 잘못된 입력은 throw.
 * `'010-1234-5678'` → `'01012345678'`, `'+82-10-1234-5678'` → `'821012345678'` (X, 12자리 throw).
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length < 9 || digits.length > 11) {
    throw new Error(`phone must contain 9~11 digits after normalization (got ${digits.length})`);
  }
  return digits;
}

/**
 * D4: 생년월일 정규화 — YYYY-MM-DD 형식 + Date.UTC normalize 검증. 잘못된 입력은 throw.
 * `'1995-13-99'` → throw, `'2000-02-29'` (윤년) → `'2000-02-29'`, `'2023-02-29'` (비윤년) → throw.
 */
export function normalizeBirthDate(input: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (m === null) {
    throw new Error('birthDate must match YYYY-MM-DD');
  }
  const yearStr = m[1];
  const monthStr = m[2];
  const dayStr = m[3];
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    throw new Error('birthDate regex match invalid');
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`birthDate is not a valid calendar date: ${input}`);
  }
  return `${yearStr}-${monthStr}-${dayStr}`;
}

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
 *       ...encryptUserPiiInput({ phone: '010-1234-5678', birthDate: '1995-03-15' }),
 *     },
 *   });
 *
 * D4: 입력 정규화 — 잘못된 phone/birthDate는 throw (API serializer 레이어 zod 검증으로 가로채는 패턴 권장).
 * D2: ciphertext + key_version atomic set — 키 회전 race 차단.
 * 필드 미명시 시 결과에도 포함되지 않아 partial update 지원. null 전달 시 컬럼 NULL.
 */
export function encryptUserPiiInput(input: UserPiiPlaintextInput): UserPiiEncryptedInput {
  const result: UserPiiEncryptedInput = {};

  if ('phone' in input) {
    if (input.phone === null || input.phone === undefined) {
      result.phone = null;
    } else {
      const normalized = normalizePhone(input.phone);
      const { ciphertext, keyVersion } = encryptPiiWithVersion(normalized);
      result.phone = ciphertext;
      result.phoneKeyVersion = keyVersion;
    }
  }

  if ('birthDate' in input) {
    if (input.birthDate === null || input.birthDate === undefined) {
      result.birthDate = null;
    } else {
      const normalized = normalizeBirthDate(input.birthDate);
      const { ciphertext, keyVersion } = encryptPiiWithVersion(normalized);
      result.birthDate = ciphertext;
      result.birthDateKeyVersion = keyVersion;
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

// === CANDID-031 (D8) — write 런타임 가드 ============================================
//
// 목적: encryptUserPiiInput 헬퍼 누락 시 string 평문이 phone/birthDate 컬럼으로 그대로
//       전달되는 시나리오를 *런타임*에 차단한다. D6(ESLint 정적 가드)는 raw query를,
//       D7(serializer)는 응답 직렬화를 다루며, D8은 prisma write 경로의 마지막 방어선이다.
//
// 본 가드는 piiExtension의 query.user 후크에서 호출되지만, named export로도 노출하여
// 단위 테스트가 extension 내부 구조에 의존하지 않도록 한다 (L-003 학습 적용).

function piiViolationMessage(field: 'phone' | 'birthDate'): string {
  return (
    `CANDID-031 (D8): User.${field} string plaintext input rejected. ` +
    `Use encryptUserPiiInput({ ${field} }) to encrypt before passing to prisma.user ` +
    `create/update/upsert. For raw queries, call encryptPiiWithVersion() directly.`
  );
}

/**
 * Prisma update 시 사용되는 `{ set: <value> }` wrapper 형태를 검사하기 위한 헬퍼.
 * `prisma.user.update({ data: { phone: { set: '010-...' } } })` 같은 우회 경로 차단용.
 */
function isStringSetWrapper(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (!('set' in value)) return false;
  return typeof (value as { set: unknown }).set === 'string';
}

/**
 * User write 입력에서 string 평문 PII가 발견되면 throw.
 *
 * 통과 케이스: `null` / `undefined` / `Buffer` / `Uint8Array` / 해당 필드 부재.
 * 차단 케이스: `phone: 'string'`, `birthDate: 'string'`, `phone: { set: 'string' }` (update wrapper).
 *
 * 단위 테스트 친화 — extension 내부 구조에 의존하지 않고 직접 호출 가능 (L-003 적용).
 * 신규 PII 컬럼 추가 시 본 함수에 필드 검사 추가 필수.
 */
export function assertUserPiiInputShape(data: unknown): void {
  if (data === null || data === undefined) return;
  if (typeof data !== 'object') return;
  const d = data as Record<string, unknown>;

  if ('phone' in d) {
    const phone = d.phone;
    if (typeof phone === 'string' || isStringSetWrapper(phone)) {
      throw new Error(piiViolationMessage('phone'));
    }
  }

  if ('birthDate' in d) {
    const birthDate = d.birthDate;
    if (typeof birthDate === 'string' || isStringSetWrapper(birthDate)) {
      throw new Error(piiViolationMessage('birthDate'));
    }
  }
}
