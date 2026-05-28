import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

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

let uniqCounter = 0;
function uniqEmail(): string {
  uniqCounter += 1;
  return `singleton-${Date.now()}-${uniqCounter}@example.test`;
}

describe('integration: lib/prisma.ts singleton wiring (L-005)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await truncateAll();
    await disconnectTestPrisma();
    // 운영 singleton(prisma)은 globalThis.__prisma로 cache되므로 본 suite에서 추가 disconnect 호출하지
    // 않는다. setup.ts가 다음 suite에서도 동일 connection을 재사용하도록 허용 — 운영 환경 미러.
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
