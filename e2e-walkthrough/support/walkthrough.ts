import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { expect, type APIRequestContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Walkthrough E2E — 공용 지원 모듈 (기존 e2e/ 스위트와 독립적인 "처음부터" 구성).
//
// 이 스위트는 헤디드(브라우저 창 표시) 관람용으로 설계되었다. setup 프로젝트가 시드 데이터를
// 만들어 .data/walkthrough.json + storageState 파일에 남기고, 각 spec이 이를 읽어 사용한다.
// (Playwright setup 프로젝트는 메모리를 공유하지 않으므로 파일을 통해 핸드오프한다.)
// ─────────────────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

// 리포 루트 — 실행 cwd에 의존하지 않도록 이 파일 위치(e2e-walkthrough/support) 기준 고정.
export const REPO_ROOT = path.resolve(__dirname, '../..');

// dev 앱 서버(public schema)와 동일한 DB. Playwright 프로세스는 .env를 자동 로드하지 않으므로 폴백 제공.
const DEFAULT_DATABASE_URL = 'postgresql://candidate:candidate@localhost:5432/candidate_web';
const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
process.env.DATABASE_URL = DATABASE_URL;

/** 비밀번호 — 10자 이상 + 3-of-4 문자군(대/소/숫자/특수) (lib/auth/validation 정합). */
export const PASSWORD = 'WalkThru2026!';

/** setup이 남기는 핸드오프 산출물 경로. */
export const DATA_DIR = path.resolve(__dirname, '..', '.data');
export const AUTH_DIR = path.resolve(__dirname, '..', '.auth');
export const SHARED_DATA_FILE = path.join(DATA_DIR, 'walkthrough.json');
export const CANDIDATE_STATE = path.join(AUTH_DIR, 'candidate.json');
export const RECRUITER_STATE = path.join(AUTH_DIR, 'recruiter.json');

/** setup → spec 으로 넘기는 시드 데이터 형태. */
export interface SharedData {
  candidateEmail: string;
  recruiterEmail: string;
  jobId: number;
  jobTitle: string;
}

/** 실행마다 고유 이메일 — dev DB의 UNIQUE(email) 충돌 방지(@example.com=RFC 2606 예약). */
export function uniqueEmail(prefix = 'walk'): string {
  return `${prefix}+${crypto.randomUUID()}@example.com`;
}

// 단일 PrismaClient — setup에서만 사용(이메일 인증 플래그/카테고리 보장). spec에서는 미사용.
let _prisma: PrismaClient | null = null;
export function prisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  return _prisma;
}

/** signup API로 신규 계정 생성. page/context의 쿠키 jar에 인증 쿠키가 부착된다. */
export async function signup(rq: APIRequestContext, email: string): Promise<void> {
  const res = await rq.post('/api/v1/auth/signup', {
    data: {
      email,
      password: PASSWORD,
      passwordConfirm: PASSWORD,
      name: 'Walkthrough 사용자',
      termsAgreed: true,
      privacyAgreed: true,
      ageConfirmed: true,
    },
  });
  expect(res.status(), `signup 실패(${res.status()}): ${(await res.text()).slice(0, 200)}`).toBe(
    201,
  );
}

/** grant-role CLI로 DB users.role 변경(self-signup은 항상 CANDIDATE이므로 운영자는 이 경로로만 발급). */
export async function grantRole(
  email: string,
  role: 'CANDIDATE' | 'RECRUITER' | 'ADMIN',
): Promise<void> {
  try {
    await execFileAsync('pnpm', ['tsx', 'scripts/admin/grant-role.ts', email, role], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL },
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`grant-role 실패(${email} → ${role}): ${stderr.slice(0, 300) || String(err)}`);
  }
}

/** 공고 생성에 필요한 직군 카테고리(id) 보장 — fresh DB에는 시드가 없으므로 upsert로 만든다. */
export async function ensureJobCategory(): Promise<number> {
  const db = prisma();
  const cat = await db.jobCategory.upsert({
    where: { slug: 'dev' },
    update: { active: true },
    create: { name: '개발', slug: 'dev', sortOrder: 1, active: true },
  });
  return cat.id;
}

/** 최소 유효 PDF(매직바이트 %PDF) — 이력서 첨부 업로드용. */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf-8',
);

export function writeSharedData(data: SharedData): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SHARED_DATA_FILE, JSON.stringify(data, null, 2));
}

/** spec에서 시드 데이터를 읽는다. setup이 선행(프로젝트 dependency)이라 항상 존재한다. */
export function readSharedData(): SharedData {
  if (!fs.existsSync(SHARED_DATA_FILE)) {
    throw new Error(
      `시드 데이터 없음(${SHARED_DATA_FILE}). setup 프로젝트가 먼저 실행되어야 합니다.`,
    );
  }
  return JSON.parse(fs.readFileSync(SHARED_DATA_FILE, 'utf-8')) as SharedData;
}
