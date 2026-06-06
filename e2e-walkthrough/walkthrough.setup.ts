import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import {
  AUTH_DIR,
  CANDIDATE_STATE,
  RECRUITER_STATE,
  ensureJobCategory,
  grantRole,
  prisma,
  signup,
  uniqueEmail,
  writeSharedData,
} from './support/walkthrough';

// ─────────────────────────────────────────────────────────────────────────────
// 시드 setup — 모든 spec보다 먼저 1회 실행(프로젝트 dependency).
//  1) 운영자(RECRUITER) 계정 + OPEN 공고 1건 생성 → 공개/백오피스 페이지가 실제 데이터로 렌더.
//  2) 이메일 인증된 지원자 계정 생성(BR-AUTH-04 — 지원서 제출 게이트 통과).
//  3) 두 계정의 storageState + 공유 데이터(jobId 등)를 파일로 남겨 spec이 재사용.
// 이 프로젝트는 request/CLI/prisma만 사용하므로 헤디드여도 브라우저 창을 띄우지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

setup('시드: 운영자·공고·검증된 지원자 생성', async ({ browser }) => {
  setup.setTimeout(90_000);
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const categoryId = await ensureJobCategory();

  // ── 운영자: 가입 → RECRUITER 승격 → storageState 저장 ──
  const recruiterEmail = uniqueEmail('walk-recruiter');
  const rctx = await browser.newContext();
  await signup(rctx.request, recruiterEmail);
  await grantRole(recruiterEmail, 'RECRUITER');
  await rctx.storageState({ path: RECRUITER_STATE });

  // ── OPEN 공고 1건 생성(운영자 권한) ──
  const jobTitle = `프론트엔드 개발자 (Walkthrough ${Date.now()})`;
  const created = await rctx.request.post('/api/admin/v1/job-postings', {
    data: {
      title: jobTitle,
      jobCategoryId: categoryId,
      employmentType: 'FULL_TIME',
      careerLevel: 'ANY',
      contentHtml:
        '<p>Walkthrough E2E 자동 생성 공고입니다. Next.js / TypeScript 경험을 우대합니다.</p>',
      opensAt: '2026-06-01T00:00:00.000Z',
      closesAt: '2026-12-31T00:00:00.000Z',
    },
  });
  expect(created.status(), `공고 생성 실패: ${(await created.text()).slice(0, 300)}`).toBe(201);
  const jobId = (await created.json()).id as number;

  const opened = await rctx.request.patch(`/api/admin/v1/job-postings/${jobId}`, {
    data: { status: 'OPEN' },
  });
  expect(opened.status(), `공고 OPEN 전환 실패: ${(await opened.text()).slice(0, 300)}`).toBe(200);
  await rctx.close();

  // ── 지원자: 가입 → 이메일 인증(DB 직접) → storageState 저장 ──
  const candidateEmail = uniqueEmail('walk-candidate');
  const cctx = await browser.newContext();
  await signup(cctx.request, candidateEmail);
  await prisma().user.update({
    where: { email: candidateEmail },
    data: { emailVerifiedAt: new Date() },
  });
  await cctx.storageState({ path: CANDIDATE_STATE });
  await cctx.close();

  await prisma().$disconnect();

  writeSharedData({ candidateEmail, recruiterEmail, jobId, jobTitle });
});
