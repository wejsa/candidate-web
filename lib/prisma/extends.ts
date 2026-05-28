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

// CANDID-034 Step 3 — Application PII snapshot compute 함수 5쌍 (L-003 명시 export).
// 각 compute는 needs에 *_snapshot_key_version 컬럼을 포함하여 향후 v2 키 분기에서 시그니처 안정.

export function computeDecryptedApplicantName(application: {
  applicantNameSnapshot: Uint8Array | null;
  applicantNameSnapshotKeyVersion: number | null;
}): string | null {
  if (application.applicantNameSnapshot === null) return null;
  return decryptPii(toBuffer(application.applicantNameSnapshot));
}

export function computeDecryptedApplicantEmail(application: {
  applicantEmailSnapshot: Uint8Array | null;
  applicantEmailSnapshotKeyVersion: number | null;
}): string | null {
  if (application.applicantEmailSnapshot === null) return null;
  return decryptPii(toBuffer(application.applicantEmailSnapshot));
}

export function computeDecryptedPhoneSnapshot(application: {
  phoneSnapshot: Uint8Array | null;
  phoneSnapshotKeyVersion: number | null;
}): string | null {
  if (application.phoneSnapshot === null) return null;
  return decryptPii(toBuffer(application.phoneSnapshot));
}

export function computeDecryptedBirthDateSnapshot(application: {
  birthDateSnapshot: Uint8Array | null;
  birthDateSnapshotKeyVersion: number | null;
}): string | null {
  if (application.birthDateSnapshot === null) return null;
  return decryptPii(toBuffer(application.birthDateSnapshot));
}

export function computeDecryptedAddressSnapshot(application: {
  addressSnapshot: Uint8Array | null;
  addressSnapshotKeyVersion: number | null;
}): string | null {
  if (application.addressSnapshot === null) return null;
  return decryptPii(toBuffer(application.addressSnapshot));
}

/**
 * CANDID-032: result 정의를 별도 export하여 통합 테스트(V4)에서 needs/컬럼명을 직접 단정할 수 있게 한다.
 *
 * 배경: Prisma 6의 `Prisma.defineExtension`은 `(client) => Client` 형태의 클로저를 반환하므로
 * `piiExtension.result.user.X.needs` 같은 직접 introspection이 불가능하다. 본 객체를 별도 hoist하면
 * 통합 테스트가 컴파일타임 + 런타임 양쪽에서 needs 시그니처를 검증할 수 있다.
 *
 * query hook 정의는 `Prisma.defineExtension` 인수 안에서만 callback 파라미터 타입이 추론되므로
 * 본 hoist에서 제외한다 (result만 통합 테스트가 필요).
 */
export const piiExtensionResultDefinition = {
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
  application: {
    applicantNameSnapshot: {
      needs: { applicantNameSnapshot: true, applicantNameSnapshotKeyVersion: true },
      compute: computeDecryptedApplicantName,
    },
    applicantEmailSnapshot: {
      needs: { applicantEmailSnapshot: true, applicantEmailSnapshotKeyVersion: true },
      compute: computeDecryptedApplicantEmail,
    },
    phoneSnapshot: {
      needs: { phoneSnapshot: true, phoneSnapshotKeyVersion: true },
      compute: computeDecryptedPhoneSnapshot,
    },
    birthDateSnapshot: {
      needs: { birthDateSnapshot: true, birthDateSnapshotKeyVersion: true },
      compute: computeDecryptedBirthDateSnapshot,
    },
    addressSnapshot: {
      needs: { addressSnapshot: true, addressSnapshotKeyVersion: true },
      compute: computeDecryptedAddressSnapshot,
    },
  },
} as const;

/**
 * 통합 테스트(V4)가 piiExtensionDefinition.result.{model}.{field}.needs로 introspect할 수 있도록
 * name + result를 한 객체로 묶어 export. query는 `Prisma.defineExtension` 호출부에서 별도 정의.
 */
export const piiExtensionDefinition = {
  name: 'pii-encryption',
  result: piiExtensionResultDefinition,
} as const;

/**
 * Prisma User + Application 모델의 PII 컬럼을 자동 복호화하는 result extension.
 * needs에 *_key_version 컬럼을 포함하여 키 회전 분기 시 시그니처 안정성 보장.
 *
 * 사용 예:
 *   const user = await prisma.user.findUnique({ where: { id } });
 *   // user.phone, user.birthDate 모두 평문 string (또는 null)로 반환됨.
 *
 *   const app = await prisma.application.findUnique({ where: { id } });
 *   // app.applicantNameSnapshot/applicantEmailSnapshot/phoneSnapshot/birthDateSnapshot/addressSnapshot
 *   // 모두 평문 string (또는 null). 외부 응답 전에 toApplicationPublic(Step 4)으로 마스킹 필요.
 */
export const piiExtension = Prisma.defineExtension({
  name: 'pii-encryption',
  result: piiExtensionResultDefinition,
  // CANDID-031 (D8) — write 런타임 가드.
  // User: assertUserPiiInputShape — string 평문 phone/birthDate 입력 차단.
  // Application: assertApplicationPiiInputShape — string 평문 5쌍 snapshot 입력 차단 (CANDID-034 Step 3).
  // L-007 한계: top-level write op만 적용. nested write 우회(`user.update({ data: { applications: { create: {...} } } })`)는
  //   여기서 차단되지 않음 — encryptApplicationPiiSnapshotInput 명시 호출 컨벤션 + ESLint(CANDID-031 D6) 정적 가드로 보완.
  //   nested write 회귀 통합 테스트는 CANDID-005-FU2 위임.
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
    application: {
      async create({ args, query }) {
        assertApplicationPiiInputShape(args.data);
        return query(args);
      },
      async update({ args, query }) {
        assertApplicationPiiInputShape(args.data);
        return query(args);
      },
      async upsert({ args, query }) {
        assertApplicationPiiInputShape(args.create);
        assertApplicationPiiInputShape(args.update);
        return query(args);
      },
      async updateMany({ args, query }) {
        assertApplicationPiiInputShape(args.data);
        return query(args);
      },
      async createMany({ args, query }) {
        const dataArr = Array.isArray(args.data) ? args.data : [args.data];
        for (const row of dataArr) {
          assertApplicationPiiInputShape(row);
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

// === CANDID-034 (CANDID-005 FU1) Step 2 — Application PII snapshot wiring ============
//
// applications 테이블의 PII snapshot 5쌍(BR-PII-03 익명화 보존)을 위한 normalize/encrypt
// 헬퍼 + 런타임 가드. 본 Step은 헬퍼 + 단위 테스트만 신설하고, Prisma `$extends` 통합
// (result.application + query.application 후크)은 Step 3에서 추가한다.
//
// SSOT: lib/pii/fields.ts의 APPLICATION_PII_SNAPSHOT_FIELDS. 신규 필드 추가 시
// 본 파일의 헬퍼 시그니처도 함께 확장 (5필드 명시 normalize 경로 때문 — derive 불가).

import {
  APPLICATION_PII_SNAPSHOT_FIELDS,
  type ApplicationPiiSnapshotField,
} from '@/lib/pii/fields';

/**
 * 이름 정규화 — 양끝 trim + 1~100자 길이 검증. 잘못된 입력은 throw.
 */
export function normalizeName(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new Error(`name must be 1~100 chars after trim (got ${trimmed.length})`);
  }
  return trimmed;
}

/**
 * 이메일 정규화 — trim + lowercase + 단순 형식(local@domain.tld) + 3~254자 길이 검증.
 * RFC 5321 SMTP 경로 길이 상한 254자. 형식 검증은 fail-fast 수준 — 정밀 검증은 zod 레이어 책임.
 */
export function normalizeEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 254) {
    throw new Error(`email length must be 3~254 (got ${trimmed.length})`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error('email must match basic format local@domain.tld');
  }
  return trimmed;
}

/**
 * 주소 정규화 — 양끝 trim + 1~500자 길이 검증. 한국 도로명/지번/영문 주소 모두 수용 범위.
 */
export function normalizeAddress(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new Error(`address must be 1~500 chars after trim (got ${trimmed.length})`);
  }
  return trimmed;
}

export type ApplicationPiiSnapshotPlaintextInput = {
  applicantNameSnapshot?: string | null;
  applicantEmailSnapshot?: string | null;
  phoneSnapshot?: string | null;
  birthDateSnapshot?: string | null;
  addressSnapshot?: string | null;
};

export type ApplicationPiiSnapshotEncryptedInput = {
  applicantNameSnapshot?: Buffer | null;
  applicantNameSnapshotKeyVersion?: number;
  applicantEmailSnapshot?: Buffer | null;
  applicantEmailSnapshotKeyVersion?: number;
  phoneSnapshot?: Buffer | null;
  phoneSnapshotKeyVersion?: number;
  birthDateSnapshot?: Buffer | null;
  birthDateSnapshotKeyVersion?: number;
  addressSnapshot?: Buffer | null;
  addressSnapshotKeyVersion?: number;
};

/**
 * Application PII snapshot 입력 암호화 헬퍼. 지원서 제출(CANDID-015 entry) 트랜잭션에서
 * `prisma.application.create` 직전 호출하여 5쌍의 평문을 BYTEA + keyVersion으로 변환한다.
 *
 *   await prisma.application.create({
 *     data: {
 *       applicationNumber: '...', userId, jobPostingId, submittedAt: new Date(),
 *       ...encryptApplicationPiiSnapshotInput({
 *         applicantNameSnapshot: '홍길동',
 *         applicantEmailSnapshot: 'foo@example.com',
 *         phoneSnapshot: '010-1234-5678',
 *         birthDateSnapshot: '1995-03-15',
 *         addressSnapshot: '서울시 강남구 테헤란로 123',
 *       }),
 *     },
 *   });
 *
 * - 필드 미명시 시 결과에도 포함되지 않아 partial update 지원 (`'X' in input` 검사).
 * - `null` 전달 시 컬럼 NULL set, keyVersion은 결과 누락 (BYTEA NULL → keyVersion 의미 없음).
 * - 각 필드별 정규화: name/email/address는 자체 normalize, phone은 normalizePhone 재사용,
 *   birthDate는 normalizeBirthDate 재사용. 잘못된 평문은 throw — 호출자 측 zod 검증 권장.
 * - 키 버전 atomic 결합 (L-006 / CANDID-030 D2 패턴) — encryptPiiWithVersion 사용.
 */
export function encryptApplicationPiiSnapshotInput(
  input: ApplicationPiiSnapshotPlaintextInput,
): ApplicationPiiSnapshotEncryptedInput {
  const result: ApplicationPiiSnapshotEncryptedInput = {};

  if ('applicantNameSnapshot' in input) {
    if (input.applicantNameSnapshot === null || input.applicantNameSnapshot === undefined) {
      result.applicantNameSnapshot = null;
    } else {
      const normalized = normalizeName(input.applicantNameSnapshot);
      const { ciphertext, keyVersion } = encryptPiiWithVersion(normalized);
      result.applicantNameSnapshot = ciphertext;
      result.applicantNameSnapshotKeyVersion = keyVersion;
    }
  }

  if ('applicantEmailSnapshot' in input) {
    if (input.applicantEmailSnapshot === null || input.applicantEmailSnapshot === undefined) {
      result.applicantEmailSnapshot = null;
    } else {
      const normalized = normalizeEmail(input.applicantEmailSnapshot);
      const { ciphertext, keyVersion } = encryptPiiWithVersion(normalized);
      result.applicantEmailSnapshot = ciphertext;
      result.applicantEmailSnapshotKeyVersion = keyVersion;
    }
  }

  if ('phoneSnapshot' in input) {
    if (input.phoneSnapshot === null || input.phoneSnapshot === undefined) {
      result.phoneSnapshot = null;
    } else {
      const normalized = normalizePhone(input.phoneSnapshot);
      const { ciphertext, keyVersion } = encryptPiiWithVersion(normalized);
      result.phoneSnapshot = ciphertext;
      result.phoneSnapshotKeyVersion = keyVersion;
    }
  }

  if ('birthDateSnapshot' in input) {
    if (input.birthDateSnapshot === null || input.birthDateSnapshot === undefined) {
      result.birthDateSnapshot = null;
    } else {
      const normalized = normalizeBirthDate(input.birthDateSnapshot);
      const { ciphertext, keyVersion } = encryptPiiWithVersion(normalized);
      result.birthDateSnapshot = ciphertext;
      result.birthDateSnapshotKeyVersion = keyVersion;
    }
  }

  if ('addressSnapshot' in input) {
    if (input.addressSnapshot === null || input.addressSnapshot === undefined) {
      result.addressSnapshot = null;
    } else {
      const normalized = normalizeAddress(input.addressSnapshot);
      const { ciphertext, keyVersion } = encryptPiiWithVersion(normalized);
      result.addressSnapshot = ciphertext;
      result.addressSnapshotKeyVersion = keyVersion;
    }
  }

  return result;
}

/**
 * Raw query 등 $extends 우회 경로에서 Application PII snapshot Bytes → string 복호화.
 * 일반 prisma.application.findX 경로는 piiExtension(Step 3 도입)이 자동 처리한다.
 * 함수 본문은 decryptUserPiiField와 동일 — 의도 명시용 별칭.
 */
export const decryptApplicationPiiSnapshotField = decryptUserPiiField;

function applicationPiiSnapshotViolationMessage(field: ApplicationPiiSnapshotField): string {
  return (
    `CANDID-034 Step 2 (D8 pattern): Application.${field} string plaintext input rejected. ` +
    `Use encryptApplicationPiiSnapshotInput({ ${field} }) to encrypt before passing to ` +
    `prisma.application create/update/upsert. For raw queries, call encryptPiiWithVersion() directly.`
  );
}

/**
 * Application write 입력에서 string 평문 PII가 발견되면 throw.
 *
 * 통과 케이스: `null` / `undefined` / `Buffer` / `Uint8Array` / 해당 필드 부재.
 * 차단 케이스: 5필드 중 하나라도 `: 'string'` 또는 `: { set: 'string' }` (update wrapper).
 *
 * L-006 (3-layer defense) + L-007 (top-level write only — nested write는 Step 3 query.application
 * 후크에서 처리하되 본 함수는 단위 테스트가 extension 내부 구조에 의존하지 않도록 명시 export).
 * SSOT(APPLICATION_PII_SNAPSHOT_FIELDS) 기반 derive — 신규 필드 추가 시 본 함수 자동 인식.
 */
export function assertApplicationPiiInputShape(data: unknown): void {
  if (data === null || data === undefined) return;
  if (typeof data !== 'object') return;
  const d = data as Record<string, unknown>;

  for (const field of APPLICATION_PII_SNAPSHOT_FIELDS) {
    if (field in d) {
      const v = d[field];
      if (typeof v === 'string' || isStringSetWrapper(v)) {
        throw new Error(applicationPiiSnapshotViolationMessage(field));
      }
    }
  }
}
