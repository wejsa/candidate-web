import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Page } from '@playwright/test';
import { signupViaApi } from './auth';

// CANDID-053 Step 13 — 백오피스 E2E 운영자 픽스처.
//   self-signup은 항상 CANDIDATE이므로(가입 API가 role 강제), 운영자는 grant-role CLI로만 발급한다
//   (scripts/admin/grant-role.ts — 최초 운영자 부트스트랩 경로와 동일). 인가 SSOT가 DB role 재조회라
//   가입으로 받은 access 토큰을 그대로 둔 채 DB role만 올리면 동일 page가 즉시 운영자로 동작한다(재로그인 불요).

const execFileAsync = promisify(execFile);

// 통합 테스트 기본값과 동일(tests/integration/setup.ts) — 인라인 DATABASE_URL 없으면 폴백.
const DEFAULT_DATABASE_URL = 'postgresql://candidate:candidate@localhost:5432/candidate_web';

/**
 * 신규 계정을 만들고 DB role을 승격해 page를 운영자(RECRUITER/ADMIN) 인증 상태로 만든다.
 * @returns 생성된 계정 email
 */
export async function operatorViaApi(
  page: Page,
  role: 'RECRUITER' | 'ADMIN' = 'RECRUITER',
): Promise<{ email: string }> {
  const { email } = await signupViaApi(page);
  // grant-role CLI는 server-only 미반입(자체 PrismaClient) — DATABASE_URL만 있으면 동작.
  await execFileAsync('pnpm', ['tsx', 'scripts/admin/grant-role.ts', email, role], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL },
  });
  return { email };
}
