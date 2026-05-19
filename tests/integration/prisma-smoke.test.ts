import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { getColumnInfo } from './helpers/raw';

// CANDID-035 Step 1 — 통합 테스트 인프라 smoke.
//
// migrate deploy + extended PrismaClient + truncate 사이클이 동작하는지 1차 확인.
// 본 파일이 통과하면 Step 2/3의 본격 회귀 테스트가 동일 인프라 위에서 실행 가능하다.

describe('integration: prisma smoke', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
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
});
