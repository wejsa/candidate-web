// CANDID-018 Step 2 — assertSubmitReady 단위 테스트.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { JobStatus } from '@prisma/client';

vi.mock('@/lib/prisma', () => {
  const userFindUnique = vi.fn();
  const jobFindUnique = vi.fn();
  const draftFindUnique = vi.fn();
  const resumeCount = vi.fn();
  return {
    basePrisma: {
      user: { findUnique: userFindUnique },
      jobPosting: { findUnique: jobFindUnique },
      applicationDraft: { findUnique: draftFindUnique },
      resumeFile: { count: resumeCount },
    },
    prisma: {},
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    user: { findUnique: Mock };
    jobPosting: { findUnique: Mock };
    applicationDraft: { findUnique: Mock };
    resumeFile: { count: Mock };
  };
};
const { assertSubmitReady, collectIncompleteReasons } = await import(
  '@/lib/applications/validate'
);
const { AppError } = await import('@/lib/errors');

const USER_ID = 42;
const JOB_POSTING_ID = 100;
const DRAFT_ID = 7;
const NOW = new Date('2026-05-27T00:00:00Z');
const FUTURE = new Date('2026-06-01T00:00:00Z');
const PAST = new Date('2026-05-26T23:59:59Z');

const COMPLETE_PAYLOAD = {
  schemaVersion: 1 as const,
  meta: { currentStep: 3 as const, completedSteps: [1, 2, 3] as (1 | 2 | 3)[] },
  step1_personal: {
    name: '홍길동',
    phone: '010-1234-5678',
    birthDate: '1995-03-15',
    careerLevel: 'EXPERIENCED' as const,
  },
};

beforeEach(() => {
  basePrisma.user.findUnique.mockReset();
  basePrisma.jobPosting.findUnique.mockReset();
  basePrisma.applicationDraft.findUnique.mockReset();
  basePrisma.resumeFile.count.mockReset();
});

function setupHappyPath() {
  basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date('2026-04-01') });
  basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
    id: JOB_POSTING_ID,
    status: JobStatus.OPEN,
    closesAt: FUTURE,
  });
  basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({
    id: DRAFT_ID,
    payloadJson: COMPLETE_PAYLOAD,
  });
  basePrisma.resumeFile.count.mockResolvedValueOnce(1);
}

describe('assertSubmitReady — happy path', () => {
  it('모든 조건 충족 → draftId + payload 반환', async () => {
    setupHappyPath();
    const result = await assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    expect(result.draftId).toBe(DRAFT_ID);
    expect(result.payload.step1_personal?.name).toBe('홍길동');
  });
});

describe('assertSubmitReady — 에러 분기', () => {
  it('User 미존재 → USER_NOT_FOUND', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('이메일 미인증 → AUTH_EMAIL_NOT_VERIFIED', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: null });
    await expect(
      assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'AUTH_EMAIL_NOT_VERIFIED' });
  });

  it('공고 미존재 → JOB_NOT_FOUND', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce(null);
    await expect(
      assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('공고 DRAFT 상태 → JOB_NOT_FOUND (정보 누출 차단)', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: JOB_POSTING_ID,
      status: JobStatus.DRAFT,
      closesAt: FUTURE,
    });
    await expect(
      assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('공고 CLOSED → JOB_CLOSED', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: JOB_POSTING_ID,
      status: JobStatus.CLOSED,
      closesAt: FUTURE,
    });
    await expect(
      assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'JOB_CLOSED' });
  });

  it('마감 시간 지남 (BR-APP-04) → APP_DEADLINE_PASSED', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: JOB_POSTING_ID,
      status: JobStatus.OPEN,
      closesAt: PAST,
    });
    await expect(
      assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_DEADLINE_PASSED' });
  });

  it('Draft 미존재 → APP_DRAFT_NOT_FOUND', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: JOB_POSTING_ID,
      status: JobStatus.OPEN,
      closesAt: FUTURE,
    });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    await expect(
      assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_DRAFT_NOT_FOUND' });
  });

  it('이력서 0개 → APP_SUBMIT_INCOMPLETE (details에 resumeFile)', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: JOB_POSTING_ID,
      status: JobStatus.OPEN,
      closesAt: FUTURE,
    });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({
      id: DRAFT_ID,
      payloadJson: COMPLETE_PAYLOAD,
    });
    basePrisma.resumeFile.count.mockResolvedValueOnce(0);
    try {
      await assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
      throw new Error('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as InstanceType<typeof AppError>;
      expect(appErr.code).toBe('APP_SUBMIT_INCOMPLETE');
      expect(appErr.details?.some((d) => d.field === 'resumeFile')).toBe(true);
    }
  });

  it('step1_personal 누락 → APP_SUBMIT_INCOMPLETE (details에 step1_personal)', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: JOB_POSTING_ID,
      status: JobStatus.OPEN,
      closesAt: FUTURE,
    });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({
      id: DRAFT_ID,
      payloadJson: { schemaVersion: 1, meta: { currentStep: 1, completedSteps: [] } },
    });
    basePrisma.resumeFile.count.mockResolvedValueOnce(1);
    try {
      await assertSubmitReady({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
      throw new Error('Expected throw');
    } catch (err) {
      const appErr = err as InstanceType<typeof AppError>;
      expect(appErr.code).toBe('APP_SUBMIT_INCOMPLETE');
      expect(appErr.details?.some((d) => d.field === 'step1_personal')).toBe(true);
    }
  });
});

describe('collectIncompleteReasons', () => {
  it('완전한 payload + resume 1개 → 빈 배열', () => {
    expect(collectIncompleteReasons(COMPLETE_PAYLOAD, 1)).toEqual([]);
  });

  it('resume 0개 → resumeFile 항목 추가', () => {
    const reasons = collectIncompleteReasons(COMPLETE_PAYLOAD, 0);
    expect(reasons.some((r) => r.field === 'resumeFile')).toBe(true);
  });

  it('step1_personal 빈 name → step1_personal 항목 추가', () => {
    const incomplete = {
      ...COMPLETE_PAYLOAD,
      step1_personal: { ...COMPLETE_PAYLOAD.step1_personal!, name: '   ' },
    };
    const reasons = collectIncompleteReasons(incomplete, 1);
    expect(reasons.some((r) => r.field === 'step1_personal')).toBe(true);
  });

  it('payload null → step1_personal 항목 추가', () => {
    const reasons = collectIncompleteReasons(null, 1);
    expect(reasons.some((r) => r.field === 'step1_personal')).toBe(true);
  });

  it('careerLevel 잘못된 값 → step1_personal 항목 추가', () => {
    const incomplete = {
      ...COMPLETE_PAYLOAD,
      step1_personal: { ...COMPLETE_PAYLOAD.step1_personal!, careerLevel: 'UNKNOWN' as never },
    };
    const reasons = collectIncompleteReasons(incomplete, 1);
    expect(reasons.some((r) => r.field === 'step1_personal')).toBe(true);
  });
});
