import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { getApplicationSnapshotRaw } from './helpers/raw';
import { buildApplicationNumber, seedJobPosting, seedUser } from './helpers/seed';

// CANDID-035 Step 3 (V3) — L-007 nested write 회귀 SSOT 증거 테스트.
//
// **이 테스트는 *회귀 가드* 가 아니라 *현재 한계의 SSOT 증거* 다.**
// fail = wiring이 강화된 것 (좋은 변화 — L-007 한계 해소 가능성 신호).
// pass = nested write가 query.application 후크를 우회해 평문 BYTEA 저장 — 알려진 한계.
//
// 배경 (lib/prisma/extends.ts L149-151):
//   piiExtension의 query.{model} 후크는 *top-level write only* 발동.
//   `prisma.user.update({ data: { applications: { create: { ... } } } })`처럼
//   상위 모델 관계로 child를 생성하는 *nested write*는 query.application 후크를
//   trigger하지 않으므로 assertApplicationPiiInputShape이 발동하지 않는다.
//
// 우회 방지 컨벤션: `.claude/domains/_base/conventions/database.md`에 추가.

// CANDID-032 (PR #73 리뷰 D-MAJOR-1 응답): Prisma 6.19+에서 BYTEA 컬럼은 client-side coercion이
// 엄격해져 `applicantNameSnapshot: '홍길동' as any` 같은 string→Bytes 자동 변환이
// "Could not convert from base64 encoded bytes to PrismaValue::Bytes"로 거부된다.
// 즉 본 V3 증거 테스트의 "평문 string이 BYTEA에 저장됨" 단정 자체가 Prisma 6에서 비현실적이 되었다.
// L-007 nested write 한계 자체는 여전히 유효(query.application 후크 미발동)하지만,
// 증거 코드 경로가 driver-level에서 차단되어 본 형태의 회귀 가드는 의미를 잃었다.
//
// follow-up 추적 task: CANDID-005-FU2 (`lib/prisma/extends.ts` L-007 주석에 기존 명시).
//   본 .skip은 *Prisma 6 driver 변경*에 의한 일시 보류이며 L-007 nested write 차단 follow-up과 통합
//   진행. 신규 검증 형태(예: `$queryRawUnsafe`로 BYTEA에 raw bytes INSERT 후 piiExtension wiring
//   우회 입증)는 본 FU2 안에서 재설계한다.
describe.skip('integration: L-007 nested write regression witness (V3) — Prisma 6 BYTEA coercion 변경으로 skip', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await truncateAll();
    await disconnectTestPrisma();
  });

  it('regression-witness: nested user.update→applications.create bypasses query.application guard', async () => {
    const prisma = getTestPrisma();
    const user = await seedUser();
    const posting = await seedJobPosting();

    // ⚠️ 의도된 우회 케이스 — query.application 후크가 발동하지 않으므로
    // 평문 string이 BYTEA 컬럼에 UTF-8 raw bytes로 저장된다.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        applications: {
          create: {
            applicationNumber: buildApplicationNumber(),
            jobPostingId: posting.id,
            submittedAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 의도된 nested 우회 — L-007 SSOT 증거
            applicantNameSnapshot: '홍길동' as any,
          },
        },
      },
    });

    const apps = await prisma.application.findMany({ where: { userId: user.id } });
    expect(apps).toHaveLength(1);
    const raw = await getApplicationSnapshotRaw(apps[0]!.id);
    expect(raw).not.toBeNull();

    // SSOT 증거: BYTEA에 UTF-8 raw bytes '홍길동' (9바이트) 그대로 저장.
    // GCM ciphertext(iv 12B + tag 16B + ct ≥ 1B = 29B) 미만이면 평문 통과 단정.
    expect(raw!.applicant_name_snapshot).not.toBeNull();
    expect(raw!.applicant_name_snapshot!.toString('utf8')).toBe('홍길동');
    expect(raw!.applicant_name_snapshot!.length).toBeLessThan(29);

    // ⚠️ 본 단정이 fail하면 wiring이 강화된 것 — L-007 한계 해소 신호.
    //    docs/retro/CANDID-035-retro.md와 conventions/database.md L-007 항목 갱신 필요.
  });
});
