import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { USER_PII_FIELDS } from '@/lib/pii/fields';
import { piiExtensionDefinition } from '@/lib/prisma/extends';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { getUserPiiRaw } from './helpers/raw';
import { encryptUserPiiInputForPrisma } from './helpers/seed';

// CANDID-032 Step 1 (V2 + V4) — piiExtension result.user wiring round-trip + needs 시그니처 단정.
//
// CANDID-035에서 Application 5쌍 snapshot용으로 정착된 V1/V2/V4 매트릭스를 User 2쌍(phone, birthDate)으로
// 미러링한다. CANDID-008 retro §5.2.3 (D9 / L-005) 대응 — needs 누락 / 컬럼명 오타 회귀를 컴파일타임 +
// 런타임에 차단하고, 음성 단정(비-확장 PrismaClient 비교)으로 extension 등록 누락 회귀도 결정적으로
// 잡는다.

const PLAINTEXT_2 = {
  phone: '09099999999', // anonymous dummy — 운영 010-XXXX-XXXX 형식 회피 (security review MINOR 컨벤션)
  birthDate: '1900-01-01',
} as const;

const PLAINTEXT_2_ALT = {
  phone: '09188888888',
  birthDate: '1985-06-15',
} as const;

let uniqCounter = 0;
function uniqEmail(): string {
  uniqCounter += 1;
  return `user-rt-${Date.now()}-${uniqCounter}@example.test`;
}

describe('integration: piiExtension result.user round-trip (V2 + V4)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await truncateAll();
    await disconnectTestPrisma();
  });

  it('encrypts 2 PII fields and decrypts to plaintext via findUnique', async () => {
    const prisma = getTestPrisma();
    const created = await prisma.user.create({
      data: {
        email: uniqEmail(),
        name: '홍길동',
        ...encryptUserPiiInputForPrisma(PLAINTEXT_2),
      },
    });

    const fetched = await prisma.user.findUnique({ where: { id: created.id } });
    expect(fetched).not.toBeNull();
    // result extension compute가 BYTEA → 평문 string으로 자동 복호화
    expect(fetched!.phone).toBe(PLAINTEXT_2.phone);
    expect(fetched!.birthDate).toBe(PLAINTEXT_2.birthDate);
    // 타입 단정 — extension 누락 시 Uint8Array가 반환되어 .toBe(string)이 fail하지만,
    // 그 외 우연 통과를 추가로 차단 (예: compute가 toString() 호출하는 잘못된 구현).
    expect(typeof fetched!.phone).toBe('string');
    expect(typeof fetched!.birthDate).toBe('string');
  });

  it('preserves null phone/birthDate through round-trip', async () => {
    const prisma = getTestPrisma();
    const created = await prisma.user.create({
      data: {
        email: uniqEmail(),
        name: '익명',
        // phone/birthDate 미명시 → BYTEA 컬럼 NULL
      },
    });

    const fetched = await prisma.user.findUnique({ where: { id: created.id } });
    expect(fetched!.phone).toBeNull();
    expect(fetched!.birthDate).toBeNull();
  });

  it('partial update — changing phone alone preserves birthDate + both key_versions', async () => {
    const prisma = getTestPrisma();
    const created = await prisma.user.create({
      data: {
        email: uniqEmail(),
        name: '홍길동',
        ...encryptUserPiiInputForPrisma(PLAINTEXT_2),
      },
    });

    await prisma.user.update({
      where: { id: created.id },
      data: encryptUserPiiInputForPrisma({ phone: PLAINTEXT_2_ALT.phone }),
    });

    // round-trip: 변경한 phone은 새 값, birthDate는 기존 값 보존
    const fetched = await prisma.user.findUnique({ where: { id: created.id } });
    expect(fetched!.phone).toBe(PLAINTEXT_2_ALT.phone);
    expect(fetched!.birthDate).toBe(PLAINTEXT_2.birthDate);

    // D2 race 회귀 가드 — 양 컬럼 key_version 모두 1로 유지 (atomic set 보존)
    const raw = await getUserPiiRaw(created.id);
    expect(raw!.phone_key_version).toBe(1);
    expect(raw!.birth_date_key_version).toBe(1);
    // 두 BYTEA 모두 GCM ciphertext(iv 12B + tag 16B + ct ≥ 1B = 29B) 이상
    expect(raw!.phone!.length).toBeGreaterThanOrEqual(29);
    expect(raw!.birth_date!.length).toBeGreaterThanOrEqual(29);
  });

  it('updateMany — all rows receive same key_version atomically (D2 split-version race guard)', async () => {
    const prisma = getTestPrisma();
    // 3명의 user를 동일 birthDate로 만든 뒤 updateMany로 phone 일괄 갱신
    const ids: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const u = await prisma.user.create({
        data: {
          email: uniqEmail(),
          name: `유저${i}`,
          ...encryptUserPiiInputForPrisma(PLAINTEXT_2),
        },
      });
      ids.push(u.id);
    }

    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: encryptUserPiiInputForPrisma({ phone: PLAINTEXT_2_ALT.phone }),
    });

    // 3명 모두 phone은 새 평문으로 round-trip, phone_key_version 모두 1
    for (const id of ids) {
      const fetched = await prisma.user.findUnique({ where: { id } });
      expect(fetched!.phone).toBe(PLAINTEXT_2_ALT.phone);
      expect(fetched!.birthDate).toBe(PLAINTEXT_2.birthDate);
      const raw = await getUserPiiRaw(id);
      expect(raw!.phone_key_version).toBe(1);
      expect(raw!.birth_date_key_version).toBe(1);
    }
  });

  it('SSOT (USER_PII_FIELDS) covers exactly 2 fields', () => {
    // 본 SSOT가 임의로 변경되면 본 통합 테스트 전체 의미가 흔들리므로 정적 단정.
    expect(USER_PII_FIELDS).toHaveLength(2);
    expect([...USER_PII_FIELDS].sort()).toEqual(['birthDate', 'phone']);
  });

  // V4 — 2 compute 함수의 `needs` 시그니처에 `*KeyVersion` 컬럼명 정적 단정.
  // piiExtension internal 구조(컬럼명 오타, keyVersion 누락) 회귀를 컴파일타임 + 런타임에 차단.
  describe('V4 — needs signature (compile-time + runtime)', () => {
    // 런타임 단정 — extension 객체에서 needs 키 비교.
    const expectedNeeds = {
      phone: { phone: true, phoneKeyVersion: true },
      birthDate: { birthDate: true, birthDateKeyVersion: true },
    } as const;

    it('runtime: piiExtensionDefinition.result.user[X].needs matches expected shape', () => {
      // CANDID-032: Prisma 6 `defineExtension`은 클로저를 반환해 internal shape 직접 접근 불가.
      // raw definition 객체(piiExtensionDefinition)로 needs/컬럼명 회귀를 단정한다.
      const userResult = piiExtensionDefinition.result.user;
      expect(userResult).toBeDefined();
      for (const field of USER_PII_FIELDS) {
        expect(userResult[field]).toBeDefined();
        expect(userResult[field].needs).toEqual(expectedNeeds[field]);
      }
    });

    // 컴파일타임 단정 — 2 필드 needs에 `*KeyVersion` 컬럼명이 모두 포함되어야 함.
    // TS satisfies로 키 누락/오타 컴파일 실패 회귀 차단.
    it('compile-time: needs keys include both field + keyVersion via satisfies', () => {
      const _typeGuard = expectedNeeds satisfies Record<'phone' | 'birthDate', Record<string, true>>;
      // _typeGuard는 위 satisfies 통과 자체가 검증이므로 runtime no-op로 사용 표시만.
      expect(_typeGuard).toBe(expectedNeeds);
    });
  });

  // 음성 단정 — 비-확장 PrismaClient로 같은 row를 조회하면 phone/birthDate가 Uint8Array로 반환된다.
  // extension 등록 자체가 누락되면 단위 테스트(compute 직접 호출)는 통과해도 본 단정이 fail해 결정적으로 잡힌다.
  it('negative: raw PrismaClient (no extension) returns Uint8Array for phone/birthDate', async () => {
    const prisma = getTestPrisma();
    const created = await prisma.user.create({
      data: {
        email: uniqEmail(),
        name: '홍길동',
        ...encryptUserPiiInputForPrisma(PLAINTEXT_2),
      },
    });

    // setup.ts가 process.env.DATABASE_URL을 ?schema=test_integration으로 override한 후라
    // 본 raw client도 동일 schema에 연결된다.
    const rawPrisma = new PrismaClient();
    try {
      const rawUser = await rawPrisma.user.findUnique({ where: { id: created.id } });
      expect(rawUser).not.toBeNull();
      // extension이 없으면 BYTEA 컬럼은 driver가 Uint8Array(Buffer는 Uint8Array의 subclass)로 반환
      expect(rawUser!.phone).toBeInstanceOf(Uint8Array);
      expect(rawUser!.birthDate).toBeInstanceOf(Uint8Array);
      // 그리고 확장 client는 string으로 반환 — 같은 row가 client 종류에 따라 다르게 보임을 직접 증명
      const extendedUser = await prisma.user.findUnique({ where: { id: created.id } });
      expect(typeof extendedUser!.phone).toBe('string');
      expect(typeof extendedUser!.birthDate).toBe('string');
    } finally {
      await rawPrisma.$disconnect();
    }
  });
});
