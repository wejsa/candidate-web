import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { disconnectTestPrisma, getTestPrisma, truncateAll } from './helpers/prisma';
import { seedJobPosting, seedUser } from './helpers/seed';

// CANDID-040 Step 3 (T-MAJOR) — resume_files partial UNIQUE 통합 가드.
//
// 대상 인덱스: uk_resume_files_one_per_draft
//   ON resume_files(draft_id) WHERE draft_id IS NOT NULL AND virus_scan_status IN ('PENDING','CLEAN')
// (CANDID-016 Step 2 v2 마이그 — INFECTED/FAILED는 UNIQUE 평가 제외하여 악성/실패 후 재업로드 허용)
//
// 검증:
//   1) 동일 draft 활성(PENDING) 첨부 2건 → 2번째 P2002 (동시 탭 race DB 최종 방어선)
//   2) INFECTED 잔존 + 새 PENDING → 허용 (partial 조건으로 영구 409 차단 회귀 가드)

function buildResumeData(draftId: number, ownerUserId: number, overrides?: Record<string, unknown>) {
  return {
    ownerUserId,
    draftId,
    originalFilename: 'resume.pdf',
    storedPath: `resumes/2026/05/${randomUUID()}.pdf`,
    contentType: 'application/pdf',
    fileSize: BigInt(1024),
    checksumSha256: 'a'.repeat(64),
    ...overrides,
  };
}

describe('integration: resume_files partial UNIQUE (uk_resume_files_one_per_draft)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  async function seedDraft() {
    const prisma = getTestPrisma();
    const user = await seedUser();
    const posting = await seedJobPosting();
    const draft = await prisma.applicationDraft.create({
      data: {
        userId: user.id,
        jobPostingId: posting.id,
        payloadJson: {},
        lastSavedAt: new Date(),
      },
    });
    return { prisma, user, draft };
  }

  it('동일 draft 활성(PENDING) 첨부 2건 → 2번째 P2002 UNIQUE 위반', async () => {
    const { prisma, user, draft } = await seedDraft();
    await prisma.resumeFile.create({ data: buildResumeData(draft.id, user.id) });
    await expect(
      prisma.resumeFile.create({ data: buildResumeData(draft.id, user.id) }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('INFECTED 잔존 + 새 PENDING 첨부 → 허용 (INFECTED는 partial UNIQUE 평가 제외)', async () => {
    const { prisma, user, draft } = await seedDraft();
    await prisma.resumeFile.create({
      data: buildResumeData(draft.id, user.id, { virusScanStatus: 'INFECTED' }),
    });
    // 인과 고정(MINOR): INFECTED row가 동일 draft에 실제 잔존함을 사전 단언 — 성공이 "제외 조건" 덕분임을 명확히.
    expect(
      await prisma.resumeFile.count({
        where: { draftId: draft.id, virusScanStatus: 'INFECTED' },
      }),
    ).toBe(1);
    const second = await prisma.resumeFile.create({
      data: buildResumeData(draft.id, user.id), // 기본 PENDING
    });
    expect(second.id).toBeGreaterThan(0);
    expect(second.virusScanStatus).toBe('PENDING');
  });

  it('FAILED 잔존 + 새 PENDING 첨부 → 허용 (FAILED도 partial UNIQUE 평가 제외)', async () => {
    // v2 인덱스 WHERE는 IN ('PENDING','CLEAN') — INFECTED/FAILED 둘 다 제외. FAILED 분기 회귀 가드.
    const { prisma, user, draft } = await seedDraft();
    await prisma.resumeFile.create({
      data: buildResumeData(draft.id, user.id, { virusScanStatus: 'FAILED' }),
    });
    const second = await prisma.resumeFile.create({
      data: buildResumeData(draft.id, user.id), // 기본 PENDING
    });
    expect(second.id).toBeGreaterThan(0);
  });

  it('CLEAN 활성 + 새 PENDING 첨부 → P2002 (CLEAN도 활성 평가 대상)', async () => {
    // UNIQUE 평가 대상은 PENDING+CLEAN 둘 다. 스캔 완료(CLEAN) 첨부가 활성으로 남은 흔한 충돌 경로.
    const { prisma, user, draft } = await seedDraft();
    await prisma.resumeFile.create({
      data: buildResumeData(draft.id, user.id, { virusScanStatus: 'CLEAN' }),
    });
    await expect(
      prisma.resumeFile.create({ data: buildResumeData(draft.id, user.id) }), // PENDING
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
