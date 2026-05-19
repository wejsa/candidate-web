import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { type ApplicationPiiSnapshotPlaintextInput } from '@/lib/prisma/extends';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { getApplicationSnapshotRaw } from './helpers/raw';
import {
  buildApplicationNumber,
  encryptApplicationSnapshotForPrisma,
  seedJobPosting,
  seedUser,
} from './helpers/seed';

// CANDID-035 Step 2 (V1) — query.application 5 op 런타임 가드 회귀 차단.
//
// 검증 대상:
//   create / update / upsert / updateMany / createMany 각 op에서
//     - string 평문 5쌍 snapshot 필드 입력 → throw (`CANDID-034 Step 2 (D8 pattern)` 메시지)
//     - encryptApplicationPiiSnapshotInput 결과 입력 → happy
//         + BYTEA 컬럼이 GCM ciphertext(iv 12B + tag 16B + ct ≥ 1B)로 저장 (octet_length ≥ 29)
//         + keyVersion = 1
//
// L-006 (3-layer defense 런타임 layer 회귀 가드)
// L-007 (top-level write만 적용. nested write 우회는 Step 3에서 SSOT 증거 테스트로 처리)

const PLAINTEXT_VIOLATION_PATTERN =
  /CANDID-034 Step 2 \(D8 pattern\).*string plaintext input rejected/;

function buildEncryptedSnapshot(partial?: Partial<ApplicationPiiSnapshotPlaintextInput>) {
  return encryptApplicationSnapshotForPrisma({
    applicantNameSnapshot: '홍길동',
    applicantEmailSnapshot: 'test@example.test',
    phoneSnapshot: '09099999999',
    birthDateSnapshot: '1900-01-01',
    addressSnapshot: '서울 강남구 테헤란로 123',
    ...partial,
  });
}

describe('integration: piiExtension query.application write guard (V1)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  describe('create()', () => {
    it('throws on string plaintext applicantNameSnapshot', async () => {
      const prisma = getTestPrisma();
      const user = await seedUser();
      const posting = await seedJobPosting();

      await expect(
        prisma.application.create({
          data: {
            applicationNumber: buildApplicationNumber(),
            userId: user.id,
            jobPostingId: posting.id,
            submittedAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 의도적 평문 주입으로 가드 발동 검증
            applicantNameSnapshot: '홍길동' as any,
          },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });

    it('accepts encrypted input and stores GCM ciphertext (octet_length ≥ 29)', async () => {
      const prisma = getTestPrisma();
      const user = await seedUser();
      const posting = await seedJobPosting();

      const created = await prisma.application.create({
        data: {
          applicationNumber: buildApplicationNumber(),
          userId: user.id,
          jobPostingId: posting.id,
          submittedAt: new Date(),
          ...buildEncryptedSnapshot(),
        },
      });

      const raw = await getApplicationSnapshotRaw(created.id);
      expect(raw).not.toBeNull();
      // 5쌍 모두 GCM ciphertext 길이(iv 12B + tag 16B + ct ≥ 1B = 29B) 이상
      expect(raw!.applicant_name_snapshot!.length).toBeGreaterThanOrEqual(29);
      expect(raw!.applicant_email_snapshot!.length).toBeGreaterThanOrEqual(29);
      expect(raw!.phone_snapshot!.length).toBeGreaterThanOrEqual(29);
      expect(raw!.birth_date_snapshot!.length).toBeGreaterThanOrEqual(29);
      expect(raw!.address_snapshot!.length).toBeGreaterThanOrEqual(29);
      // CANDID-035 Step 3 (H010 보강): 5쌍 keyVersion = 1 단정 — keyVersion NULL/0 회귀 차단.
      expect(created.applicantNameSnapshotKeyVersion).toBe(1);
      expect(created.applicantEmailSnapshotKeyVersion).toBe(1);
      expect(created.phoneSnapshotKeyVersion).toBe(1);
      expect(created.birthDateSnapshotKeyVersion).toBe(1);
      expect(created.addressSnapshotKeyVersion).toBe(1);
    });
  });

  describe('update()', () => {
    it('throws on string plaintext addressSnapshot', async () => {
      const prisma = getTestPrisma();
      const user = await seedUser();
      const posting = await seedJobPosting();
      const created = await prisma.application.create({
        data: {
          applicationNumber: buildApplicationNumber(),
          userId: user.id,
          jobPostingId: posting.id,
          submittedAt: new Date(),
        },
      });

      await expect(
        prisma.application.update({
          where: { id: created.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 가드 발동 검증
          data: { addressSnapshot: '서울 강남' as any },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });

    // CANDID-035 Step 3 (H009 보강): `{ set: 'string' }` wrapper 분기 — isStringSetWrapper.
    it('throws on { set: "string" } wrapper (isStringSetWrapper branch)', async () => {
      const prisma = getTestPrisma();
      const user = await seedUser();
      const posting = await seedJobPosting();
      const created = await prisma.application.create({
        data: {
          applicationNumber: buildApplicationNumber(),
          userId: user.id,
          jobPostingId: posting.id,
          submittedAt: new Date(),
        },
      });

      await expect(
        prisma.application.update({
          where: { id: created.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wrapper 분기 발동
          data: { phoneSnapshot: { set: '09099999999' } as any },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });
  });

  describe('upsert()', () => {
    it('throws on string plaintext in create branch', async () => {
      const prisma = getTestPrisma();
      const user = await seedUser();
      const posting = await seedJobPosting();

      await expect(
        prisma.application.upsert({
          where: { applicationNumber: buildApplicationNumber() },
          create: {
            applicationNumber: buildApplicationNumber(),
            userId: user.id,
            jobPostingId: posting.id,
            submittedAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            phoneSnapshot: '09099999999' as any,
          },
          update: {},
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });
  });

  describe('updateMany()', () => {
    it('throws on string plaintext birthDateSnapshot', async () => {
      const prisma = getTestPrisma();
      const user = await seedUser();
      const posting = await seedJobPosting();
      await prisma.application.create({
        data: {
          applicationNumber: buildApplicationNumber(),
          userId: user.id,
          jobPostingId: posting.id,
          submittedAt: new Date(),
        },
      });

      await expect(
        prisma.application.updateMany({
          where: { userId: user.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { birthDateSnapshot: '1900-01-01' as any },
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);
    });
  });

  describe('createMany()', () => {
    it('throws on any row with string plaintext applicantEmailSnapshot', async () => {
      const prisma = getTestPrisma();
      const user = await seedUser();
      const posting = await seedJobPosting();

      await expect(
        prisma.application.createMany({
          data: [
            {
              applicationNumber: buildApplicationNumber(),
              userId: user.id,
              jobPostingId: posting.id,
              submittedAt: new Date(),
            },
            {
              applicationNumber: buildApplicationNumber(),
              userId: user.id,
              jobPostingId: posting.id,
              submittedAt: new Date(),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              applicantEmailSnapshot: 'test@example.test' as any,
            },
          ],
        }),
      ).rejects.toThrow(PLAINTEXT_VIOLATION_PATTERN);

      // CANDID-035 Step 3 (H012 보강): throw 시 row[0]도 미커밋 (트랜잭션성 단정).
      const count = await prisma.application.count({ where: { userId: user.id } });
      expect(count).toBe(0);
    });
  });
});
