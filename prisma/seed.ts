// 'server-only' import는 의도적으로 제외: 본 파일은 Node CLI(`tsx prisma/seed.ts`)
// 컨텍스트에서 실행되며, 'server-only'는 Next.js RSC client bundle 감지용 가드라
// CLI에서 적용 시 향후 빌드 환경 변화에 따라 throw 가능성. RSC 가드는 lib/prisma.ts만 유지.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 본 task(CANDID-002)는 seed 골격만 제공합니다.
  // 실제 시드 데이터는 후속 task에서 채웁니다:
  //   - CANDID-004: job_categories 기본 직군 (개발/디자인/기획/경영지원/...)
  //   - 필요 시 dev/staging 환경 전용 더미 공고

  // 예시 (CANDID-004 시점 활성):
  // await prisma.jobCategory.upsert({
  //   where: { code: 'DEV' },
  //   update: {},
  //   create: { code: 'DEV', name: '개발', sortOrder: 1 },
  // });

  console.warn('[seed] CANDID-002 골격 단계 — 시드 데이터 없음 (no-op)');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e: unknown) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
