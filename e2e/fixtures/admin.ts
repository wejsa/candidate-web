import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { signupViaApi } from './auth';

// CANDID-053 Step 13 — 백오피스 E2E 운영자 픽스처.
//   self-signup은 항상 CANDIDATE이므로(가입 API가 role 강제), 운영자는 grant-role CLI로만 발급한다
//   (scripts/admin/grant-role.ts — 최초 운영자 부트스트랩 경로와 동일). 인가 SSOT가 DB role 재조회라
//   가입으로 받은 access 토큰을 그대로 둔 채 DB role만 바꾸면 동일 page가 즉시 그 권한으로 동작한다(재로그인 불요).

const execFileAsync = promisify(execFile);

// 리포 루트 — Playwright 실행 cwd에 의존하지 않도록 픽스처 위치(e2e/fixtures) 기준 고정(commonjs __dirname).
const REPO_ROOT = path.resolve(__dirname, '../..');

// dev 앱 서버가 사용하는 base DB(public schema)와 동일해야 한다.
// ⚠️ 통합 테스트의 ?schema=test_integration 와는 다름 — E2E는 dev 앱(public schema)을 대상으로 한다.
const DEFAULT_DATABASE_URL = 'postgresql://candidate:candidate@localhost:5432/candidate_web';

export type GrantableRole = 'CANDIDATE' | 'RECRUITER' | 'ADMIN';

/**
 * grant-role CLI로 DB users.role을 변경한다(승격/강등 모두). 순수 헬퍼 — signup과 분리되어
 * 전/후 대조(즉시 강등 반영) 시나리오에서 재사용 가능. 실패 시 CLI stderr를 메시지에 실어 진단성 확보.
 */
export async function grantRole(email: string, role: GrantableRole): Promise<void> {
  try {
    await execFileAsync('pnpm', ['tsx', 'scripts/admin/grant-role.ts', email, role], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL },
    });
  } catch (err) {
    // execFile 에러의 stderr(실제 원인 — 사용자 미존재/DB 연결 등)를 메시지에 부착.
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`grant-role 실패(${email} → ${role}): ${stderr.slice(0, 300) || String(err)}`);
  }
}

/**
 * 신규 계정을 만들고 DB role을 승격해 page를 운영자(RECRUITER/ADMIN) 인증 상태로 만든다.
 * @returns 생성된 계정 email
 */
export async function operatorViaApi(
  page: Page,
  role: 'RECRUITER' | 'ADMIN' = 'RECRUITER',
): Promise<{ email: string }> {
  const { email } = await signupViaApi(page);
  await grantRole(email, role);
  return { email };
}
