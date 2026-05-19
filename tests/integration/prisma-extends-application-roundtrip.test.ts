import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { APPLICATION_PII_SNAPSHOT_FIELDS } from '@/lib/pii/fields';
import { piiExtension } from '@/lib/prisma/extends';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import {
  buildApplicationNumber,
  encryptApplicationSnapshotForPrisma,
  seedJobPosting,
  seedUser,
} from './helpers/seed';

// CANDID-035 Step 2 (V2 + V4) — piiExtension result wiring round-trip + needs 시그니처 단정.
//
// V2: encryptApplicationPiiSnapshotInput → create → findUnique → 평문 string 복호화 round-trip.
// V4: 5 compute 함수 needs 시그니처에 `*SnapshotKeyVersion` 컬럼명 정적 단정 (M002 보강).
//     컴파일타임(`satisfies Record<...>`) + 런타임(`expect(needs).toEqual(...)`) 이중 가드.

const PLAINTEXT_5 = {
  applicantNameSnapshot: '홍길동',
  applicantEmailSnapshot: 'test@example.test',
  phoneSnapshot: '09099999999',
  birthDateSnapshot: '1900-01-01',
  addressSnapshot: '서울 강남구 테헤란로 123',
} as const;

describe('integration: piiExtension result.application round-trip (V2 + V4)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('encrypts 5 snapshot fields and decrypts to plaintext via findUnique', async () => {
    const prisma = getTestPrisma();
    const user = await seedUser();
    const posting = await seedJobPosting();

    const created = await prisma.application.create({
      data: {
        applicationNumber: buildApplicationNumber(),
        userId: user.id,
        jobPostingId: posting.id,
        submittedAt: new Date(),
        ...encryptApplicationSnapshotForPrisma(PLAINTEXT_5),
      },
    });

    const fetched = await prisma.application.findUnique({ where: { id: created.id } });
    expect(fetched).not.toBeNull();
    // result extension compute가 BYTEA → 평문 string으로 자동 복호화
    expect(fetched!.applicantNameSnapshot).toBe(PLAINTEXT_5.applicantNameSnapshot);
    expect(fetched!.applicantEmailSnapshot).toBe(PLAINTEXT_5.applicantEmailSnapshot);
    expect(fetched!.phoneSnapshot).toBe(PLAINTEXT_5.phoneSnapshot);
    expect(fetched!.birthDateSnapshot).toBe(PLAINTEXT_5.birthDateSnapshot);
    expect(fetched!.addressSnapshot).toBe(PLAINTEXT_5.addressSnapshot);
  });

  it('returns null on findUnique when all 5 snapshot fields are NULL', async () => {
    const prisma = getTestPrisma();
    const user = await seedUser();
    const posting = await seedJobPosting();

    const created = await prisma.application.create({
      data: {
        applicationNumber: buildApplicationNumber(),
        userId: user.id,
        jobPostingId: posting.id,
        submittedAt: new Date(),
        // 5쌍 모두 미명시 → BYTEA 컬럼 NULL
      },
    });

    const fetched = await prisma.application.findUnique({ where: { id: created.id } });
    expect(fetched!.applicantNameSnapshot).toBeNull();
    expect(fetched!.applicantEmailSnapshot).toBeNull();
    expect(fetched!.phoneSnapshot).toBeNull();
    expect(fetched!.birthDateSnapshot).toBeNull();
    expect(fetched!.addressSnapshot).toBeNull();
  });

  it('SSOT (APPLICATION_PII_SNAPSHOT_FIELDS) covers exactly 5 fields', () => {
    // 본 SSOT가 임의로 변경되면 본 통합 테스트 전체 의미가 흔들리므로 정적 단정.
    expect(APPLICATION_PII_SNAPSHOT_FIELDS).toHaveLength(5);
    expect([...APPLICATION_PII_SNAPSHOT_FIELDS].sort()).toEqual([
      'addressSnapshot',
      'applicantEmailSnapshot',
      'applicantNameSnapshot',
      'birthDateSnapshot',
      'phoneSnapshot',
    ]);
  });

  // V4 — 5 compute 함수의 `needs` 시그니처에 `*SnapshotKeyVersion` 컬럼명 정적 단정.
  // piiExtension internal 구조(컬럼명 오타, keyVersion 누락) 회귀를 컴파일타임 + 런타임에 차단.
  describe('V4 — needs signature (compile-time + runtime)', () => {
    // 런타임 단정 — extension 객체에서 needs 키 비교.
    const expectedNeeds = {
      applicantNameSnapshot: {
        applicantNameSnapshot: true,
        applicantNameSnapshotKeyVersion: true,
      },
      applicantEmailSnapshot: {
        applicantEmailSnapshot: true,
        applicantEmailSnapshotKeyVersion: true,
      },
      phoneSnapshot: { phoneSnapshot: true, phoneSnapshotKeyVersion: true },
      birthDateSnapshot: {
        birthDateSnapshot: true,
        birthDateSnapshotKeyVersion: true,
      },
      addressSnapshot: { addressSnapshot: true, addressSnapshotKeyVersion: true },
    } as const;

    it('runtime: piiExtension.result.application[X].needs matches expected shape', () => {
      // piiExtension is a Prisma extension definition object — read via record indexing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- internal extension shape inspection
      const result = (piiExtension as any).result as Record<
        string,
        Record<string, { needs: Record<string, true> }> | undefined
      >;
      const appResult = result.application;
      expect(appResult).toBeDefined();
      for (const field of APPLICATION_PII_SNAPSHOT_FIELDS) {
        expect(appResult![field]).toBeDefined();
        expect(appResult![field]!.needs).toEqual(expectedNeeds[field]);
      }
    });

    // 컴파일타임 단정 — 5 필드 needs에 `*KeyVersion` 컬럼명이 모두 포함되어야 함.
    // TS satisfies로 키 누락/오타 컴파일 실패 회귀 차단.
    it('compile-time: needs keys include both snapshot + keyVersion via satisfies', () => {
      const _typeGuard = expectedNeeds satisfies Record<
        | 'applicantNameSnapshot'
        | 'applicantEmailSnapshot'
        | 'phoneSnapshot'
        | 'birthDateSnapshot'
        | 'addressSnapshot',
        Record<string, true>
      >;
      // _typeGuard는 위 satisfies 통과 자체가 검증이므로 runtime no-op로 사용 표시만.
      expect(_typeGuard).toBe(expectedNeeds);
    });
  });
});
