import crypto from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { basePrisma, prisma } from '@/lib/prisma';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { encryptUserPiiInputForPrisma } from './helpers/seed';

// CANDID-032 Step 2 — L-005 대응 (회고 §5.2.4).
//
// 배경: `vitest.config.ts:coverage.exclude`가 `lib/prisma.ts`를 제외하므로 `$extends(piiExtension)`
// wiring 경로가 단위 테스트 커버리지 통계 뒤에 숨는다(L-005). exclude 자체는 `server-only` import +
// Next.js singleton 보호 의도라 유지하되, **운영 singleton 경로의 $extends wiring이 실제로 동작함**을
// 통합 테스트 1건으로 증명한다.
//
// 다른 통합 테스트는 `helpers/prisma.ts:getTestPrisma()`(별도 인스턴스 + 동일 piiExtension)를
// 사용하지만, 본 테스트는 *production 모듈 경로* (`@/lib/prisma`의 `prisma` named export)를
// 직접 import해 운영 환경과 동일한 wiring을 검증한다.
//
// truncateAll/disconnectTestPrisma는 setup.ts/helpers/prisma.ts의 라이프사이클을 따른다.

// CANDID-032 리뷰 T-MAJOR-3 응답: counter 기반 uniq는 vitest pool 변화(현재 singleFork이지만
// 향후 변경 시) 동일 ms tick 경합 가능성. crypto.randomUUID()로 정족수 충돌 0 보장.
function uniqEmail(): string {
  return `singleton-${crypto.randomUUID().slice(0, 8)}@example.test`;
}

describe('integration: lib/prisma.ts singleton wiring (L-005)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await truncateAll();
    await disconnectTestPrisma();
    // CANDID-032 리뷰 D-MAJOR-1 / S-MINOR-2 응답:
    //   운영 `prisma`(`@/lib/prisma`)는 `globalThis.__prisma` cache로 *워커별 별도 인스턴스*가 생성된다.
    //   본 suite에서 disconnect하지 않으면 워커 종료까지 idle connection이 남아 docker-compose db pool에
    //   누적될 수 있음 (CI 장기 실행 시 "too many clients"). vitest 워커 모드 미러 — 명시 disconnect.
    await basePrisma.$disconnect();
  });

  it('singleton: prisma.user.create + findUnique round-trip via $extends(piiExtension)', async () => {
    const created = await prisma.user.create({
      data: {
        email: uniqEmail(),
        name: '홍길동',
        ...encryptUserPiiInputForPrisma({ phone: '09099999999', birthDate: '1900-01-01' }),
      },
    });

    const fetched = await prisma.user.findUnique({ where: { id: created.id } });
    expect(fetched).not.toBeNull();
    // $extends(piiExtension) wiring이 실제 운영 모듈 경로에서 살아있으면 string으로 복호화됨
    expect(typeof fetched!.phone).toBe('string');
    expect(typeof fetched!.birthDate).toBe('string');
    expect(fetched!.phone).toBe('09099999999');
    expect(fetched!.birthDate).toBe('1900-01-01');
  });

  // CANDID-032 리뷰 T-MAJOR-4 응답: query.user.update 경로의 wiring도 L-005 사각지대.
  // create round-trip만 검증하면 운영 update 후크가 silently broken되어 평문 string이 BYTEA에 들어가도
  // 본 suite로는 탐지 불가. update 1건 추가로 query.user.update 후크 + result wiring 동시 증명.
  it('singleton: prisma.user.update wiring — D8 가드 + key_version 갱신 단정', async () => {
    const created = await prisma.user.create({
      data: {
        email: uniqEmail(),
        name: '홍길동',
        ...encryptUserPiiInputForPrisma({ phone: '09099999999', birthDate: '1900-01-01' }),
      },
    });

    // query.user.update 후크: string 평문은 throw (assertUserPiiInputShape D8 가드)
    await expect(
      prisma.user.update({
        where: { id: created.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 가드 발동 검증
        data: { phone: '09188888888' as any },
      }),
    ).rejects.toThrow(/CANDID-031 \(D8\)/);

    // 정상 update: encryptUserPiiInputForPrisma 후 round-trip + key_version 보존
    const updated = await prisma.user.update({
      where: { id: created.id },
      data: encryptUserPiiInputForPrisma({ phone: '09188888888' }),
    });
    expect(updated.phone).toBe('09188888888');
    expect(updated.birthDate).toBe('1900-01-01'); // 미변경 필드 보존
  });

  it('singleton: helpers/getTestPrisma()와 운영 prisma가 동일 schema/data를 본다 (반영 검증)', async () => {
    // helpers는 별도 PrismaClient 인스턴스이지만 setup.ts가 DATABASE_URL을 ?schema=test_integration로
    // override한 후이므로 양쪽이 동일 schema/row를 본다. wiring이 깨지면 두 경로의 동작이 갈라진다.
    const helperPrisma = getTestPrisma();
    const created = await helperPrisma.user.create({
      data: {
        email: uniqEmail(),
        name: '홍길동',
        ...encryptUserPiiInputForPrisma({ phone: '09099999999', birthDate: '1900-01-01' }),
      },
    });

    const viaSingleton = await prisma.user.findUnique({ where: { id: created.id } });
    expect(viaSingleton).not.toBeNull();
    expect(viaSingleton!.phone).toBe('09099999999');
  });
});
