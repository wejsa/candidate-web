import { getTestPrisma } from './prisma';

// CANDID-035 Step 1 — 회귀 단정 전용 $queryRaw 헬퍼.
//
// ESLint `no-restricted-syntax`(CANDID-031 D6)가 `$queryRaw` 사용을 차단한다.
// 본 헬퍼는 *PII wiring 자체를 검증하는 통합 테스트* 목적이므로 piiExtension 우회가
// 의도된 동작이다. 각 호출에 명시적 disable 주석 + 사유를 남긴다.

export interface ApplicationSnapshotRaw {
  applicant_name_snapshot: Buffer | null;
  applicant_email_snapshot: Buffer | null;
  phone_snapshot: Buffer | null;
  birth_date_snapshot: Buffer | null;
  address_snapshot: Buffer | null;
}

export async function getApplicationSnapshotRaw(
  applicationId: number,
): Promise<ApplicationSnapshotRaw | null> {
  const prisma = getTestPrisma();
  // eslint-disable-next-line no-restricted-syntax -- CANDID-035: BYTEA 원본 검증 (piiExtension 우회 의도)
  const rows = await prisma.$queryRaw<ApplicationSnapshotRaw[]>`
    SELECT
      applicant_name_snapshot,
      applicant_email_snapshot,
      phone_snapshot,
      birth_date_snapshot,
      address_snapshot
    FROM applications
    WHERE id = ${applicationId}
  `;
  return rows[0] ?? null;
}

export interface UserPiiRaw {
  phone: Buffer | null;
  phone_key_version: number | null;
  birth_date: Buffer | null;
  birth_date_key_version: number | null;
}

// CANDID-032 — User PII 2쌍 raw BYTEA 조회. piiExtension 우회 의도(GCM ciphertext 길이/keyVersion 단정용).
export async function getUserPiiRaw(userId: number): Promise<UserPiiRaw | null> {
  const prisma = getTestPrisma();
  // eslint-disable-next-line no-restricted-syntax -- CANDID-032: BYTEA 원본 검증 (piiExtension 우회 의도)
  const rows = await prisma.$queryRaw<UserPiiRaw[]>`
    SELECT phone, phone_key_version, birth_date, birth_date_key_version
    FROM users
    WHERE id = ${userId}
  `;
  return rows[0] ?? null;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
}

export async function getColumnInfo(tableName: string, columnLike: string): Promise<ColumnInfo[]> {
  const prisma = getTestPrisma();
  // eslint-disable-next-line no-restricted-syntax -- CANDID-035: schema 메타 조회 (PII 우회와 무관)
  const rows = await prisma.$queryRaw<ColumnInfo[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${tableName}
      AND column_name LIKE ${columnLike}
    ORDER BY column_name
  `;
  return rows;
}
