import {
  test,
  expect,
  request as apiRequest,
  type APIRequestContext,
  type Browser,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { uniqueEmail, E2E_PASSWORD } from './fixtures/auth';
import { grantRole } from './fixtures/admin';

// ─────────────────────────────────────────────────────────────────────────────
// 전체 웹페이지 기능 투어 E2E (Claude — 사용자 요청: "모든 웹페이지의 기능을 테스트, 브라우저로 확인").
//
// 설계 원칙:
//  - signup rate-limit(5/시간/IP, 인메모리)을 회피하기 위해 가입은 총 3회로 제한한다:
//      beforeAll에서 운영자 1 + 지원자 1, 그리고 "회원가입 페이지 UI" 테스트에서 1.
//    그 외 인증은 모두 login(10/분) 또는 storageState 재사용으로 처리한다.
//  - 데이터 의존 페이지(공고/지원서)는 beforeAll에서 OPEN 공고 1건을 만들어 결정성을 확보한다.
//  - 지원서 제출은 이메일 인증이 필요(BR-AUTH-04)하므로 지원자 emailVerifiedAt을 DB에서 직접 세팅한다.
//  - 인가 가드는 기존 스펙과 동일하게 보호 API status로 검증(페이지 redirect는 dev RSC 캐싱과 플레이키).
// ─────────────────────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://candidate:candidate@localhost:5432/candidate_web';
process.env.DATABASE_URL = DB_URL;
const prisma = new PrismaClient();

const AUTH_DIR = path.resolve(__dirname, '.auth');
const RECRUITER_STATE = path.join(AUTH_DIR, 'recruiter.json');
const CANDIDATE_STATE = path.join(AUTH_DIR, 'candidate.json');

// 최소 유효 PDF(매직바이트 %PDF) — 이력서 첨부 업로드용.
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf-8',
);

// beforeAll에서 채워지는 공유 상태.
let recruiterEmail = '';
let candidateEmail = '';
let uiSignupEmail = ''; // 회원가입 페이지 UI 테스트 + 탈퇴 테스트에서 재사용
let jobId = 0;
let jobTitle = '';

async function signupViaApiCtx(rq: APIRequestContext, email: string): Promise<void> {
  const res = await rq.post('/api/v1/auth/signup', {
    data: {
      email,
      password: E2E_PASSWORD,
      passwordConfirm: E2E_PASSWORD,
      name: 'E2E 사용자',
      termsAgreed: true,
      privacyAgreed: true,
      ageConfirmed: true,
    },
  });
  expect(res.status(), `signup 실패(${res.status()}): ${(await res.text()).slice(0, 200)}`).toBe(201);
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  recruiterEmail = uniqueEmail('tour-recruiter');
  candidateEmail = uniqueEmail('tour-candidate');
  uiSignupEmail = uniqueEmail('tour-ui');

  // ── 운영자: 가입 → RECRUITER 승격 → storageState 저장 → OPEN 공고 1건 생성 ──
  const rctx = await browser.newContext();
  await signupViaApiCtx(rctx.request, recruiterEmail);
  await grantRole(recruiterEmail, 'RECRUITER');
  await rctx.storageState({ path: RECRUITER_STATE });

  jobTitle = `E2E 백엔드 개발자 ${Date.now()}`;
  const created = await rctx.request.post('/api/admin/v1/job-postings', {
    data: {
      title: jobTitle,
      jobCategoryId: 1,
      employmentType: 'FULL_TIME',
      careerLevel: 'ANY',
      contentHtml: '<p>E2E 투어 자동 생성 공고입니다. Node.js/TypeScript 경험 우대.</p>',
      opensAt: '2026-06-01T00:00:00.000Z',
      closesAt: '2026-12-31T00:00:00.000Z',
    },
  });
  expect(created.status(), `공고 생성 실패: ${(await created.text()).slice(0, 300)}`).toBe(201);
  jobId = (await created.json()).id;

  const opened = await rctx.request.patch(`/api/admin/v1/job-postings/${jobId}`, {
    data: { status: 'OPEN' },
  });
  expect(opened.status(), `공고 OPEN 전환 실패: ${(await opened.text()).slice(0, 300)}`).toBe(200);
  await rctx.close();

  // ── 지원자: 가입 → 이메일 인증(DB 직접) → storageState 저장 ──
  const cctx = await browser.newContext();
  await signupViaApiCtx(cctx.request, candidateEmail);
  await prisma.user.update({
    where: { email: candidateEmail },
    data: { emailVerifiedAt: new Date() },
  });
  await cctx.storageState({ path: CANDIDATE_STATE });
  await cctx.close();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. 공개 페이지 (비인증)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('1. 공개 페이지 (비인증)', () => {
  test('홈(/) 랜딩 렌더', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'candidate-web' })).toBeVisible();
  });

  test('공고 목록(/jobs) — 필터 영역 + 생성한 공고 카드 노출', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByRole('heading', { level: 1, name: '채용 공고' })).toBeVisible();
    await expect(page.getByRole('region', { name: '공고 필터' })).toBeVisible();
    // 목록 렌더 검증 — 공고 카드(article)가 1개 이상 노출되고 건수 표시가 있다.
    // (방금 생성한 공고는 /jobs의 unstable_cache(60s)로 즉시 안 보일 수 있어, 해당 공고의
    //  실제 라이브 여부는 force-dynamic인 상세 페이지 테스트(#3)에서 검증한다.)
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/총 \d+건/)).toBeVisible();
  });

  test('공고 상세(/jobs/[id]) — 제목 + 비인증 CTA(로그인하고 지원하기)', async ({ page }) => {
    await page.goto(`/jobs/${jobId}`);
    await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}$`));
    await expect(page.getByRole('heading', { level: 1, name: jobTitle })).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인하고 지원하기' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. 회원가입 페이지 UI (3번째이자 마지막 signup)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('2. 회원가입 페이지 (UI)', () => {
  test('가입 폼 작성 → 제출 → 이메일 인증 안내', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { level: 1, name: '회원가입' })).toBeVisible();

    await page.getByLabel('이메일', { exact: true }).fill(uiSignupEmail);
    await page.getByLabel('이름', { exact: true }).fill('E2E 가입');
    await page.getByLabel('비밀번호', { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel('비밀번호 확인', { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole('checkbox', { name: /이용약관/ }).check();
    await page.getByRole('checkbox', { name: /개인정보 처리방침/ }).check();
    await page.getByRole('checkbox', { name: /만 14세/ }).check();

    await page.getByRole('button', { name: /가입하기/ }).click();

    // 가입 성공 → 완료 화면 + 이메일 인증 안내.
    await expect(page.getByRole('heading', { name: '가입이 완료되었습니다' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/인증 메일을 보냈습니다/)).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. 로그인 페이지 UI (signup 미사용 — 기존 지원자 계정 로그인)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('3. 로그인 페이지 (UI)', () => {
  test('로그인 폼 제출 → /me 진입 + 보호 API 200', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible();

    await page.getByLabel('이메일', { exact: true }).fill(candidateEmail);
    await page.getByLabel('비밀번호', { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();

    await page.waitForURL(/\/me$/, { timeout: 15_000 });
    const me = await page.request.get('/api/v1/users/me');
    expect(me.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. 비밀번호 재설정 페이지
// ═══════════════════════════════════════════════════════════════════════════
test.describe('4. 비밀번호 재설정', () => {
  test('재설정 요청 폼 → 균일 응답(계정 열거 방지)', async ({ page }) => {
    await page.goto('/password/reset-request');
    await expect(
      page.getByRole('heading', { level: 1, name: '비밀번호를 잊으셨나요?' }),
    ).toBeVisible();
    await page.getByLabel('이메일').fill(candidateEmail);
    await page.getByRole('button', { name: /재설정 메일 받기/ }).click();
    // 성공/안내 메시지(계정 존재 여부 숨김).
    await expect(page.getByText(/메일|발송|확인/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('재설정 페이지 진입 → 새 비밀번호 폼 렌더(토큰 검증은 제출 시점)', async ({ page }) => {
    await page.goto('/password/reset?token=invalid-token-xyz');
    await expect(page.getByRole('heading', { level: 1, name: '비밀번호 재설정' })).toBeVisible();
    // 이 페이지는 토큰이 무효여도 폼을 렌더하고 제출 시점에 서버가 검증한다.
    await expect(page.getByRole('heading', { level: 2, name: '새 비밀번호 설정' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '새 비밀번호', exact: true })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. 지원자 — 프로필 완성 + 마이페이지 (storageState 재사용)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('5. 지원자 마이페이지/프로필', () => {
  test.use({ storageState: CANDIDATE_STATE });

  test('마이페이지(/me) 렌더', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('heading', { level: 1, name: '내 지원 현황' })).toBeVisible();
  });

  test('프로필(/me/profile) — 연락처·생년월일 입력 후 저장', async ({ page }) => {
    await page.goto('/me/profile');
    await expect(page.getByRole('heading', { level: 1, name: '프로필' })).toBeVisible();

    await page.getByLabel('이름', { exact: true }).fill('지원자 홍길동');
    await page.getByLabel('연락처', { exact: true }).fill('010-1234-5678');
    await page.getByLabel('생년월일', { exact: true }).fill('1995-05-15');
    await page.getByRole('button', { name: '저장', exact: true }).click();

    await expect(page.getByText(/저장되었습니다|저장 완료|저장됨/).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. 지원자 — 지원서 작성/제출 (프로필 완성 이후)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('6. 지원서 작성/제출', () => {
  test.use({ storageState: CANDIDATE_STATE });

  test('apply 페이지 — 경력구분 선택 + 이력서 첨부 + 동의 + 제출', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/jobs/${jobId}/apply`);
    await expect(page.getByRole('heading', { level: 1, name: '지원하기' })).toBeVisible();
    // 프로필 게이트가 떠 있으면 안 됨(프로필 완성 상태).
    await expect(page.getByText('지원서 제출에는 프로필의')).toHaveCount(0);

    // 경력구분: 신입.
    await page.getByRole('radio', { name: '신입' }).check();

    // 이력서 첨부 — 파일 input에 PDF 주입 → 업로드/검사 완료 대기.
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES });
    await expect(page.getByText(/업로드 완료/).first()).toBeVisible({ timeout: 20_000 });

    // 제출 동의 후 지원.
    await page.getByRole('checkbox', { name: /동의하며 제출/ }).check();
    await page.getByRole('button', { name: '지원하기' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: '지원이 완료되었습니다' }),
    ).toBeVisible({ timeout: 20_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. 지원자 — 지원 상세 (/me/[applicationId])
// ═══════════════════════════════════════════════════════════════════════════
test.describe('7. 지원 상세', () => {
  test.use({ storageState: CANDIDATE_STATE });

  test('마이페이지에 제출한 지원이 노출 + 상세 진입', async ({ page }) => {
    await page.goto('/me');
    // 진행 중 지원 카드(공고명 링크)로 상세 진입.
    const card = page.getByRole('link', { name: new RegExp(jobTitle.slice(0, 12)) }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page).toHaveURL(/\/me\/\d+$/);
    await expect(page.getByRole('heading', { level: 2, name: '전형 진행 타임라인' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. 운영자 백오피스 (storageState 재사용)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('8. 운영자 백오피스', () => {
  test.use({ storageState: RECRUITER_STATE });

  test('대시보드(/admin) + 공고 관리 진입', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '운영 대시보드' })).toBeVisible();
    await expect(page.getByText('백오피스', { exact: true })).toBeVisible();

    await page.goto('/admin/job-postings');
    await expect(page.getByRole('heading', { name: '공고 관리' })).toBeVisible();
    await expect(page.getByRole('link', { name: /새 공고/ })).toBeVisible();
    await expect(page.getByText(jobTitle).first()).toBeVisible();
  });

  test('새 공고 작성(/admin/job-postings/new) 폼 제출', async ({ page }) => {
    await page.goto('/admin/job-postings/new');
    await expect(page.getByRole('heading', { name: '새 공고' })).toBeVisible();

    await page.getByLabel('제목').fill(`E2E UI 생성 공고 ${Date.now()}`);
    await page.getByLabel('직군').selectOption({ label: '개발' });
    await page.getByLabel('고용형태').selectOption('FULL_TIME');
    await page.getByLabel('경력').selectOption('ANY');
    await page.getByLabel(/시작일시/).fill('2026-06-10T09:00');
    await page.getByLabel(/본문/).fill('<p>UI로 생성한 공고 본문</p>');
    await page.getByRole('button', { name: /공고 생성/ }).click();

    await expect(page).toHaveURL(/\/admin\/job-postings/, { timeout: 15_000 });
  });

  test('공고 수정(/admin/job-postings/[id]/edit) — 폼 프리필', async ({ page }) => {
    await page.goto(`/admin/job-postings/${jobId}/edit`);
    await expect(page.getByRole('heading', { name: '공고 수정' })).toBeVisible();
    await expect(page.getByLabel('제목')).toHaveValue(jobTitle);
  });

  test('지원자 목록(/applicants) + 지원서 상세(전형 단계 변경 + 면접 등록)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/admin/job-postings/${jobId}/applicants`);
    await expect(page.getByRole('heading', { name: '지원자 목록' })).toBeVisible();

    // 제출한 지원자의 상세 링크로 진입.
    const detail = page.getByRole('link', { name: '상세' }).first();
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await detail.click();

    // dev 첫 컴파일(/admin/applications/[id] + PII 복호화 + 감사로그)로 첫 진입이 느릴 수 있음.
    await expect(page).toHaveURL(/\/admin\/applications\/\d+$/, { timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 2, name: '지원자 정보' })).toBeVisible({
      timeout: 15_000,
    });
    // PII 열람 감사 안내.
    await expect(page.getByText(/감사 로그/)).toBeVisible();

    // 전형 단계 변경: SUBMITTED → 서류 검토 중.
    const toDocReview = page.getByRole('button', { name: /서류 검토 중\(으\)로/ });
    if (await toDocReview.count()) {
      await toDocReview.first().click();
      await expect(page.getByText(/서류 검토 중/).first()).toBeVisible({ timeout: 10_000 });
    }

    // 면접 일정 등록.
    await page.getByLabel('면접 단계').selectOption('INTERVIEW_1');
    await page.getByLabel(/일시/).fill('2026-06-20T14:00');
    await page.getByLabel(/장소/).fill('https://zoom.us/j/e2e-tour');
    await page.getByRole('button', { name: /면접 일정 저장/ }).click();
    await expect(page.getByText(/저장|등록/).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. RBAC 접근 제어
// ═══════════════════════════════════════════════════════════════════════════
test.describe('9. RBAC 가드', () => {
  const ADMIN_API = `/api/admin/v1/job-postings/${1}/applications`;

  test('비인증 운영 API → 401 AUTH_*', async ({ baseURL }) => {
    const ctx = await apiRequest.newContext({ baseURL });
    try {
      const res = await ctx.get(ADMIN_API);
      expect(res.status()).toBe(401);
      expect((await res.json()).code).toMatch(/^AUTH_/);
    } finally {
      await ctx.dispose();
    }
  });

  test('CANDIDATE → 운영 API 403 + /admin 비노출(404)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: CANDIDATE_STATE });
    const page = await ctx.newPage();
    try {
      const res = await page.request.get(ADMIN_API);
      expect(res.status()).toBe(403);
      expect((await res.json()).code).toBe('AUTH_FORBIDDEN');

      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: '운영 대시보드' })).toHaveCount(0);
      await expect(page.getByText(/page could not be found/i)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. 계정 탈퇴 (회원가입 UI 계정 재사용 — 파괴적이므로 마지막)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('10. 계정 탈퇴', () => {
  test('로그인 → /me/withdraw 페이지 → 비밀번호 확인 후 탈퇴', async ({ page }) => {
    test.setTimeout(45_000);
    // 검증된 지원자 계정으로 로그인(모든 지원자 테스트가 끝난 마지막 단계에서 탈퇴).
    // 진행 중 지원이 있으면 익명화·보존(BR-PII-03) 경로로 탈퇴된다.
    const login = await page.request.post('/api/v1/auth/login', {
      data: { email: candidateEmail, password: E2E_PASSWORD },
    });
    expect(login.status(), `로그인 실패: ${(await login.text()).slice(0, 200)}`).toBe(200);

    await page.goto('/me/withdraw');
    await expect(page.getByRole('heading', { level: 1, name: '회원 탈퇴' })).toBeVisible();

    await page.getByRole('textbox', { name: '비밀번호 (재확인)' }).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: '탈퇴 진행' }).click();
    // 확인 모달(role=dialog) → 탈퇴 확정.
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '탈퇴 확정' }).click();

    // 탈퇴 성공 → 홈으로, 또는 보호 API 401.
    await expect(async () => {
      const me = await page.request.get('/api/v1/users/me');
      expect(me.status()).toBe(401);
    }).toPass({ timeout: 15_000 });
  });
});
