import { PrismaClient } from '@prisma/client';

import { piiExtension } from '@/lib/prisma/extends';

// CANDID-035 Step 1 — 통합 테스트 전용 Prisma client.
//
// dev singleton(`lib/prisma.ts`)과 분리해 별도 인스턴스를 생성한다. setup.ts가
// DATABASE_URL을 `?schema=test_integration`로 override한 후 본 모듈을 import하므로
// PrismaClient는 test schema를 사용한다.
//
// piiExtension wiring은 dev/prod와 동일한 코드 경로를 검증하기 위해 그대로 적용한다.

let _prisma: ReturnType<typeof createTestPrisma> | null = null;

function createTestPrisma() {
  return new PrismaClient().$extends(piiExtension);
}

export function getTestPrisma() {
  if (_prisma === null) {
    _prisma = createTestPrisma();
  }
  return _prisma;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (_prisma !== null) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}

// applications/users/job_postings/job_categories 트리를 정리한다. FK CASCADE 경로로
// 하위 테이블(answers/resume_files/portfolio_links/status_history/interview_schedules/
// drafts)도 함께 비워진다. application_status_history는 applications RESTRICT라 별도 등재.
// audit_logs는 FK 없는 골격이라 별도. application_number_sequences는 보조 시퀀스 테이블.
const TRUNCATE_TARGETS = [
  'application_status_history',
  'interview_schedules',
  'application_answers',
  'resume_files',
  'portfolio_links',
  'application_drafts',
  'applications',
  'application_number_sequences',
  'job_posting_questions',
  'job_postings',
  'job_categories',
  'audit_logs',
  'email_verifications',
  'password_reset_tokens',
  'auth_providers',
  'users',
];

export async function truncateAll(): Promise<void> {
  const prisma = getTestPrisma();
  const tableList = TRUNCATE_TARGETS.map((t) => `"${t}"`).join(', ');
  // eslint-disable-next-line no-restricted-syntax -- 통합 테스트 격리 전용. TRUNCATE는 PII 우회와 무관.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}
