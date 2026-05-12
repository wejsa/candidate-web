import 'server-only';
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
