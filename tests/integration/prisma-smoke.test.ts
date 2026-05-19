import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { encryptUserPiiInput } from '@/lib/prisma/extends';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { getColumnInfo } from './helpers/raw';

// CANDID-035 Step 1 — 통합 테스트 인프라 smoke.
//
// migrate deploy + extended PrismaClient + truncate 사이클이 동작하는지 1차 확인.
// 본 파일이 통과하면 Step 2/3의 본격 회귀 테스트가 동일 인프라 위에서 실행 가능하다.

// `new Uint8Array(buf)`의 Prisma 6 Exact 호환을 위한 변환 (Step 2 helpers/seed.ts와 동일 로직 미러).
function toUint8(b: Buffer | null | undefined): Uint8Array<ArrayBuffer> | null | undefined {
  if (b === null || b === undefined) return b;
  const out = new Uint8Array(b.length);
  out.set(b);
  return out as Uint8Array<ArrayBuffer>;
}

describe('integration: prisma smoke', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // H008 (CANDID-035 Step 1 review) — suite 종료 후 잔여 데이터 cleanup.
  // Step 2/3 진입 시 INSERT가 늘어나므로 다른 도구의 schema 조회 혼란 차단.
  afterAll(async () => {
    await truncateAll();
    await disconnectTestPrisma();
  });

  it('connects to test_integration schema and runs SELECT 1', async () => {
    const prisma = getTestPrisma();
    // eslint-disable-next-line no-restricted-syntax -- CANDID-035: 연결 확인용 raw SELECT
    const rows = await prisma.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`;
    expect(rows[0]?.one).toBe(1);
  });

  it('applications table exposes 5 BYTEA snapshot columns + 5 SMALLINT key_version columns', async () => {
    const byteaCols = await getColumnInfo('applications', '%\\_snapshot');
    const versionCols = await getColumnInfo('applications', '%\\_snapshot\\_key\\_version');

    // 5쌍 정확히 — 새 필드 추가 또는 CANDID-034 Step 1 rename 회귀 시 fail.
    expect(byteaCols).toHaveLength(5);
    expect(versionCols).toHaveLength(5);
    expect(byteaCols.every((c) => c.data_type === 'bytea')).toBe(true);
    expect(versionCols.every((c) => c.data_type === 'smallint')).toBe(true);
  });

  it('truncateAll() empties applications between tests', async () => {
    const prisma = getTestPrisma();
    // 직전 테스트가 무엇이든, beforeEach truncate 후 0 row여야 함.
    const count = await prisma.application.count();
    expect(count).toBe(0);
  });

  // H006 (CANDID-035 Step 1 review) — piiExtension wiring 회귀 1줄 가드.
  // $extends(piiExtension)가 깨지면 Step 2 본 검증 전체가 무의미하므로 Step 1 smoke로 차단.
  it('piiExtension wiring: user.phone round-trip (BYTEA encrypted → plaintext string)', async () => {
    const prisma = getTestPrisma();
    const piiInput = encryptUserPiiInput({
      phone: '09099999999',
      birthDate: '1900-01-01',
    });
    const created = await prisma.user.create({
      data: {
        email: `smoke-${Date.now()}@example.test`,
        name: '스모크 유저',
        phone: toUint8(piiInput.phone),
        phoneKeyVersion: piiInput.phoneKeyVersion,
        birthDate: toUint8(piiInput.birthDate),
        birthDateKeyVersion: piiInput.birthDateKeyVersion,
      },
    });
    const fetched = await prisma.user.findUnique({ where: { id: created.id } });
    expect(fetched!.phone).toBe('09099999999');
    expect(fetched!.birthDate).toBe('1900-01-01');
  });
});
