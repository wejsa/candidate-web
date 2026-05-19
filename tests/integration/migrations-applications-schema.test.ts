import { afterAll, describe, expect, it } from 'vitest';

import { disconnectTestPrisma } from './helpers/prisma';
import { getColumnInfo } from './helpers/raw';

// CANDID-035 Step 3 (V5) — 마이그레이션 SQL apply 회귀 차단.
//
// CANDID-034 Step 1에서 `applicant_name/email_key_version` 컬럼명을 `_snapshot_` 토큰
// 포함으로 rename했다 (5쌍 일관성). 향후 dev 환경에서 누군가 schema.prisma를 잘못 갱신해
// 컬럼명이 회귀하면 information_schema.columns 단정이 실패해 즉시 감지된다.

const EXPECTED_BYTEA_COLUMNS = [
  'address_snapshot',
  'applicant_email_snapshot',
  'applicant_name_snapshot',
  'birth_date_snapshot',
  'phone_snapshot',
] as const;

const EXPECTED_KEY_VERSION_COLUMNS = [
  'address_snapshot_key_version',
  'applicant_email_snapshot_key_version',
  'applicant_name_snapshot_key_version',
  'birth_date_snapshot_key_version',
  'phone_snapshot_key_version',
] as const;

describe('integration: applications migration schema (V5)', () => {
  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('5 BYTEA snapshot columns exist with exact names + bytea type', async () => {
    const cols = await getColumnInfo('applications', '%\\_snapshot');
    expect(cols).toHaveLength(5);
    expect(cols.map((c) => c.column_name).sort()).toEqual([...EXPECTED_BYTEA_COLUMNS].sort());
    expect(cols.every((c) => c.data_type === 'bytea')).toBe(true);
  });

  it('5 SMALLINT *_snapshot_key_version columns exist with exact names + smallint type', async () => {
    const cols = await getColumnInfo('applications', '%\\_snapshot\\_key\\_version');
    expect(cols).toHaveLength(5);
    expect(cols.map((c) => c.column_name).sort()).toEqual([...EXPECTED_KEY_VERSION_COLUMNS].sort());
    expect(cols.every((c) => c.data_type === 'smallint')).toBe(true);
  });
});
