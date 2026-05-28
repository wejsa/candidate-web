import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { type UserPiiPlaintextInput } from '@/lib/prisma/extends';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { getUserPiiRaw } from './helpers/raw';
import { encryptUserPiiInputForPrisma } from './helpers/seed';

// CANDID-032 Step 1 (V1) — query.user 5 op 런타임 가드 회귀 차단.
//
// 검증 대상:
//   create / update / upsert / updateMany / createMany 각 op에서
//     - string 평문 phone/birthDate 입력 → throw (`CANDID-031 (D8)` 메시지)
//     - `{ set: 'string' }` wrapper 입력 → throw (isStringSetWrapper 분기)
//     - encryptUserPiiInput 결과 입력 → happy
//         + BYTEA 컬럼이 GCM ciphertext(iv 12B + tag 16B + ct ≥ 1B = 29B) 이상
//         + key_version = 1
//
// 본 매트릭스는 prisma-extends-application-write-guard.test.ts V1 패턴을 User 2쌍 PII로 미러링한다.
// L-006(3-layer defense 런타임 layer) / L-007(top-level write only)

const PLAINTEXT_VIOLATION_PATTERN = /CANDID-031 \(D8\).*string plaintext input rejected/;

let uniqCounter = 0;
function uniqEmail(prefix = 'user-wg'): string {
  uniqCounter += 1;
  return `${prefix}-${Date.now()}-${uniqCounter}@example.test`;
}

function buildEncrypted(partial?: Partial<UserPiiPlaintextInput>) {
  return encryptUserPiiInputForPrisma({
    phone: '09099999999',
    birthDate: '1900-01-01',
    ...partial,
  });
}

describe('integration: piiExtension query.user write guard (V1)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await truncateAll();
    await disconnectTestPrisma();
  });

  describe('create()', () => {
    it('throws on string plaintext phone', async () => {
      const prisma = getTestPrisma();

      await expect(
        prisma.user.create({
          data: {
            email: uniqEmail(),
            name: '홍길동',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 의도적 평문 주입으로 가드 발동 검증
            phone: '01012345678' as any,
          },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });

    it('throws on string plaintext birthDate', async () => {
      const prisma = getTestPrisma();

      await expect(
        prisma.user.create({
          data: {
            email: uniqEmail(),
            name: '홍길동',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 가드 발동 검증
            birthDate: '1995-03-15' as any,
          },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });

    it('accepts encrypted input and stores GCM ciphertext (octet_length ≥ 29) with key_version=1', async () => {
      const prisma = getTestPrisma();
      const created = await prisma.user.create({
        data: {
          email: uniqEmail(),
          name: '홍길동',
          ...buildEncrypted(),
        },
      });

      const raw = await getUserPiiRaw(created.id);
      expect(raw).not.toBeNull();
      expect(raw!.phone!.length).toBeGreaterThanOrEqual(29);
      expect(raw!.birth_date!.length).toBeGreaterThanOrEqual(29);
      // key_version NULL/0 회귀 차단 (Application write-guard H010 패턴 미러)
      expect(raw!.phone_key_version).toBe(1);
      expect(raw!.birth_date_key_version).toBe(1);
    });
  });

  describe('update()', () => {
    it('throws on string plaintext phone', async () => {
      const prisma = getTestPrisma();
      const created = await prisma.user.create({
        data: {
          email: uniqEmail(),
          name: '홍길동',
        },
      });

      await expect(
        prisma.user.update({
          where: { id: created.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 가드 발동 검증
          data: { phone: '01099998888' as any },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });

    // isStringSetWrapper 분기 — Prisma 6의 `{ set: <value> }` update wrapper 우회 차단.
    it('throws on { set: "string" } wrapper for phone (isStringSetWrapper branch)', async () => {
      const prisma = getTestPrisma();
      const created = await prisma.user.create({
        data: {
          email: uniqEmail(),
          name: '홍길동',
        },
      });

      await expect(
        prisma.user.update({
          where: { id: created.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wrapper 분기 발동
          data: { phone: { set: '09099999999' } as any },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });

    it('throws on { set: "string" } wrapper for birthDate', async () => {
      const prisma = getTestPrisma();
      const created = await prisma.user.create({
        data: {
          email: uniqEmail(),
          name: '홍길동',
        },
      });

      await expect(
        prisma.user.update({
          where: { id: created.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wrapper 분기 발동
          data: { birthDate: { set: '1995-03-15' } as any },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });
  });

  describe('upsert()', () => {
    it('throws on string plaintext phone in create branch', async () => {
      const prisma = getTestPrisma();
      const email = uniqEmail();

      await expect(
        prisma.user.upsert({
          where: { email },
          create: {
            email,
            name: '홍길동',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            phone: '01012345678' as any,
          },
          update: {},
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });

    it('throws on string plaintext birthDate in update branch', async () => {
      const prisma = getTestPrisma();
      const email = uniqEmail();
      // 먼저 row 생성 (update branch 분기로 가도록 보장)
      await prisma.user.create({
        data: { email, name: '홍길동' },
      });

      await expect(
        prisma.user.upsert({
          where: { email },
          create: { email, name: '홍길동' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          update: { birthDate: '1995-03-15' as any },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });
  });

  describe('updateMany()', () => {
    it('throws on string plaintext phone', async () => {
      const prisma = getTestPrisma();
      // 다행 fixture 생성 (updateMany 의미 명확화)
      for (let i = 0; i < 2; i += 1) {
        await prisma.user.create({ data: { email: uniqEmail(), name: `u${i}` } });
      }

      await expect(
        prisma.user.updateMany({
          where: {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { phone: '01012345678' as any },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });
  });

  describe('createMany()', () => {
    it('throws on any row with string plaintext birthDate (single row case)', async () => {
      const prisma = getTestPrisma();

      await expect(
        prisma.user.createMany({
          data: [
            {
              email: uniqEmail(),
              name: '홍길동',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              birthDate: '1995-03-15' as any,
            },
          ],
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });

    it('throws when one row of N has string plaintext (partial commit refused)', async () => {
      const prisma = getTestPrisma();
      const cleanEmail = uniqEmail();
      const dirtyEmail = uniqEmail();

      await expect(
        prisma.user.createMany({
          data: [
            { email: cleanEmail, name: '정상' },
            {
              email: dirtyEmail,
              name: '위반',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              phone: '01012345678' as any,
            },
          ],
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);

      // throw 시 row[0]도 미커밋 (트랜잭션성 단정 — Application write-guard H012 패턴 미러)
      const count = await prisma.user.count({
        where: { email: { in: [cleanEmail, dirtyEmail] } },
      });
      expect(count).toBe(0);
    });
  });
});
