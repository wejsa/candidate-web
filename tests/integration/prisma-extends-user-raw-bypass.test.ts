import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { decryptUserPiiField } from '@/lib/prisma/extends';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { encryptUserPiiInputForPrisma } from './helpers/seed';

// CANDID-032 Step 2 — Raw query 우회 round-trip + 회귀 가드.
//
// 검증 의도:
//   1. **양성** — `$queryRaw`로 BYTEA를 직접 SELECT 후 `decryptUserPiiField` 명시 호출 round-trip
//      (helpers/raw.ts의 `getUserPiiRaw` 패턴이 실제 운영에서도 동작함을 증명)
//   2. **음성** — 같은 raw SELECT 결과를 *복호화 없이* 반환하면 Uint8Array 그대로
//      (raw 경로는 piiExtension result.user.compute을 거치지 않음 직접 증명)
//   3. **PostgreSQL 1차 방어** — `$executeRaw INSERT ... VALUES ('010-string')` 같은
//      우회 시도 시 BYTEA 컬럼 자체가 string을 거부 (driver coercion + invalid byte sequence)
//      → 런타임 가드 외에도 컬럼 타입이 1차 방어임을 명시
//
// ESLint `no-restricted-syntax` (CANDID-031 D6)는 raw $queryRaw / $executeRaw 사용을 차단한다.
// 본 파일의 raw 호출은 *piiExtension 우회 자체를 검증*하는 통합 테스트 의도이므로 각 호출마다
// disable 주석 + 사유를 명시한다 (`getApplicationSnapshotRaw` 패턴과 동일).

const PLAINTEXT = {
  phone: '09099999999',
  birthDate: '1900-01-01',
} as const;

let uniqCounter = 0;
function uniqEmail(): string {
  uniqCounter += 1;
  return `user-raw-${Date.now()}-${uniqCounter}@example.test`;
}

describe('integration: piiExtension raw query bypass (positive + negative + PostgreSQL guard)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await truncateAll();
    await disconnectTestPrisma();
  });

  it('positive: $queryRaw BYTEA → decryptUserPiiField 명시 round-trip', async () => {
    const prisma = getTestPrisma();
    const created = await prisma.user.create({
      data: {
        email: uniqEmail(),
        name: '홍길동',
        ...encryptUserPiiInputForPrisma(PLAINTEXT),
      },
    });

    // eslint-disable-next-line no-restricted-syntax -- CANDID-032: BYTEA 원본 검증 (piiExtension 우회 의도)
    const rows = await prisma.$queryRaw<Array<{ phone: Buffer | null; birth_date: Buffer | null }>>`
      SELECT phone, birth_date FROM users WHERE id = ${created.id}
    `;
    expect(rows[0]).toBeDefined();
    const { phone: rawPhone, birth_date: rawBirthDate } = rows[0]!;
    expect(rawPhone).not.toBeNull();
    expect(rawBirthDate).not.toBeNull();

    // 명시 복호화 — raw 경로에서 헬퍼 호출 컨벤션 검증
    expect(decryptUserPiiField(rawPhone)).toBe(PLAINTEXT.phone);
    expect(decryptUserPiiField(rawBirthDate)).toBe(PLAINTEXT.birthDate);
  });

  it('negative: raw $queryRaw 결과는 piiExtension result.user.compute을 거치지 않음', async () => {
    const prisma = getTestPrisma();
    const created = await prisma.user.create({
      data: {
        email: uniqEmail(),
        name: '홍길동',
        ...encryptUserPiiInputForPrisma(PLAINTEXT),
      },
    });

    // eslint-disable-next-line no-restricted-syntax -- CANDID-032: raw 경로의 wiring 우회 검증
    const rows = await prisma.$queryRaw<Array<{ phone: unknown }>>`
      SELECT phone FROM users WHERE id = ${created.id}
    `;
    const rawPhone = rows[0]?.phone;
    // raw $queryRaw는 result.user.phone.compute를 *발동시키지 않음* — Uint8Array/Buffer 그대로
    expect(rawPhone).not.toBeNull();
    expect(rawPhone).toBeInstanceOf(Uint8Array);
    // string 동등성 부정 — driver가 향후 hex/base64 string으로 바꿔도 "복호화되지 않음" 의도 보존
    expect(rawPhone).not.toBe(PLAINTEXT.phone);
  });

  it('PostgreSQL 1차 방어: $executeRaw로 string을 BYTEA에 INSERT 시도하면 driver/DB 거부', async () => {
    // 우회 시도 시나리오:
    //   '01012345678' 같은 평문 string을 phone(BYTEA) 컬럼에 INSERT.
    //   piiExtension query.user.create 후크는 raw 경로에서 발동하지 않으므로 1차 방어는 driver/DB.
    //   Prisma 6.19+ BYTEA driver coercion이 string 입력을 거부하거나 (Tagged Template literal에 ${string})
    //   PostgreSQL이 invalid byte sequence를 throw → 두 경로 모두 throw로 수렴.
    //
    // 본 단정은 *어떤* 에러든 throw됨만 확인 — driver/DB 양쪽 변경에 대한 회복력을 위해
    // 메시지 매칭은 피한다 (T-MINOR-5 회복력 원칙).
    const prisma = getTestPrisma();
    const email = uniqEmail();
    const plainStringForBytea = '01012345678';

    await expect(
      // eslint-disable-next-line no-restricted-syntax -- CANDID-032: 우회 시도 단정 — 1차 방어가 throw하는지 검증
      prisma.$executeRaw`
        INSERT INTO users (email, name, phone)
        VALUES (${email}, ${'테스트'}, ${plainStringForBytea})
      `,
    ).rejects.toThrow();

    // throw 후에는 row가 미커밋이어야 함 (1차 방어가 트랜잭션성 동작)
    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(0);
  });
});
