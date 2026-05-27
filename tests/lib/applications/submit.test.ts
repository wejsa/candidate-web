// CANDID-018 Step 2 — submitApplication 단위 테스트 (Prisma mock).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma, StageType, JobStatus } from '@prisma/client';

vi.mock('@/lib/prisma', () => {
  // wrappedPrisma용 (User PII 복호화 후 조회)
  const wrappedUserFindUnique = vi.fn();
  // assertSubmitReady용 (basePrisma)
  const baseUserFindUnique = vi.fn();
  const jobFindUnique = vi.fn();
  const draftFindUnique = vi.fn();
  const resumeCount = vi.fn();
  // tx 내부 동작
  const applicationCreate = vi.fn();
  const answerCreateMany = vi.fn();
  const resumeUpdateMany = vi.fn();
  const portfolioUpdateMany = vi.fn();
  const draftDelete = vi.fn();
  const historyCreate = vi.fn();
  const txQueryRaw = vi.fn();
  const $transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      application: { create: applicationCreate },
      applicationAnswer: { createMany: answerCreateMany },
      resumeFile: { updateMany: resumeUpdateMany },
      portfolioLink: { updateMany: portfolioUpdateMany },
      applicationDraft: { delete: draftDelete },
      applicationStatusHistory: { create: historyCreate },
      applicationNumberSequence: { create: vi.fn() },
      $queryRaw: txQueryRaw,
    }),
  );
  return {
    basePrisma: {
      user: { findUnique: baseUserFindUnique },
      jobPosting: { findUnique: jobFindUnique },
      applicationDraft: { findUnique: draftFindUnique },
      resumeFile: { count: resumeCount },
      $transaction,
      __txQueryRaw: txQueryRaw,
      __applicationCreate: applicationCreate,
      __answerCreateMany: answerCreateMany,
      __resumeUpdateMany: resumeUpdateMany,
      __portfolioUpdateMany: portfolioUpdateMany,
      __draftDelete: draftDelete,
      __historyCreate: historyCreate,
    },
    prisma: {
      user: { findUnique: wrappedUserFindUnique },
    },
  };
});

vi.mock('@/lib/email/transport', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/prisma/extends', () => ({
  encryptUserPiiInput: vi.fn((input: Record<string, string | undefined>) => {
    const result: Record<string, Uint8Array | number | undefined> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        result[key] = new Uint8Array([0x01, 0x02, 0x03]); // mock ciphertext
        result[`${key}KeyVersion`] = 1;
      }
    }
    return result;
  }),
}));

const { basePrisma, prisma: wrappedPrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    user: { findUnique: Mock };
    jobPosting: { findUnique: Mock };
    applicationDraft: { findUnique: Mock };
    resumeFile: { count: Mock };
    $transaction: Mock;
    __txQueryRaw: Mock;
    __applicationCreate: Mock;
    __answerCreateMany: Mock;
    __resumeUpdateMany: Mock;
    __portfolioUpdateMany: Mock;
    __draftDelete: Mock;
    __historyCreate: Mock;
  };
  prisma: { user: { findUnique: Mock } };
};
const { sendMail } = (await import('@/lib/email/transport')) as unknown as {
  sendMail: Mock;
};
const { submitApplication } = await import('@/lib/applications/submit');
const { AppError } = await import('@/lib/errors');

const USER_ID = 42;
const JOB_POSTING_ID = 100;
const DRAFT_ID = 7;
const APP_ID = 999;
const NOW = new Date('2026-05-27T00:00:00Z');
const FUTURE = new Date('2026-06-01T00:00:00Z');

const COMPLETE_PAYLOAD = {
  schemaVersion: 1,
  meta: { currentStep: 3, completedSteps: [1, 2, 3] },
  step1_personal: {
    name: '홍길동',
    phone: '010-1234-5678',
    birthDate: '1995-03-15',
    careerLevel: 'EXPERIENCED',
  },
  step3_answers: {
    '10': '답변 1', // SHORT_TEXT
    '11': ['option_a', 'option_b'], // MULTI_SELECT
  },
};

beforeEach(() => {
  basePrisma.user.findUnique.mockReset();
  basePrisma.jobPosting.findUnique.mockReset();
  basePrisma.applicationDraft.findUnique.mockReset();
  basePrisma.resumeFile.count.mockReset();
  basePrisma.__applicationCreate.mockReset();
  basePrisma.__answerCreateMany.mockReset();
  basePrisma.__resumeUpdateMany.mockReset();
  basePrisma.__portfolioUpdateMany.mockReset();
  basePrisma.__draftDelete.mockReset();
  basePrisma.__historyCreate.mockReset();
  basePrisma.__txQueryRaw.mockReset();
  basePrisma.$transaction.mockClear();
  wrappedPrisma.user.findUnique.mockReset();
  sendMail.mockClear();
});

function setupValidatePass() {
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
  wrappedPrisma.user.findUnique.mockResolvedValueOnce({
    email: 'user@example.com',
    name: '홍길동',
    phone: '010-1234-5678',
    birthDate: '1995-03-15',
  });
}

describe('submitApplication — happy path', () => {
  it('정상 제출 → application_number + submittedAt + currentStage 응답', async () => {
    setupValidatePass();
    basePrisma.__txQueryRaw.mockResolvedValueOnce([{ last_seq: 42 }]); // number-generator
    basePrisma.__applicationCreate.mockResolvedValueOnce({
      id: APP_ID,
      applicationNumber: 'A-202605-00042',
      submittedAt: NOW,
    });
    basePrisma.__answerCreateMany.mockResolvedValueOnce({ count: 2 });
    basePrisma.__resumeUpdateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.__portfolioUpdateMany.mockResolvedValueOnce({ count: 0 });
    basePrisma.__draftDelete.mockResolvedValueOnce({});
    basePrisma.__historyCreate.mockResolvedValueOnce({});

    const result = await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });

    expect(result.applicationNumber).toBe('A-202605-00042');
    expect(result.currentStage).toBe('SUBMITTED');
    expect(result.submittedAt).toBe(NOW.toISOString());
  });

  it('answers 일괄 생성 (string + array 두 타입 모두)', async () => {
    setupValidatePass();
    basePrisma.__txQueryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    basePrisma.__applicationCreate.mockResolvedValueOnce({
      id: APP_ID,
      applicationNumber: 'A-202605-00001',
      submittedAt: NOW,
    });
    basePrisma.__answerCreateMany.mockResolvedValueOnce({ count: 2 });
    basePrisma.__resumeUpdateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.__portfolioUpdateMany.mockResolvedValueOnce({ count: 0 });
    basePrisma.__draftDelete.mockResolvedValueOnce({});
    basePrisma.__historyCreate.mockResolvedValueOnce({});

    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });

    const createManyCall = basePrisma.__answerCreateMany.mock.calls[0]?.[0] as {
      data: { applicationId: number; questionId: number; answerText: string | null }[];
    };
    expect(createManyCall.data).toHaveLength(2);
    const shortText = createManyCall.data.find((r) => r.questionId === 10);
    expect(shortText?.answerText).toBe('답변 1');
    const multi = createManyCall.data.find((r) => r.questionId === 11);
    expect(multi?.answerText).toBeNull();
  });

  it('resume/portfolio draft_id → application_id 이전 + Draft 삭제 + StatusHistory 생성', async () => {
    setupValidatePass();
    basePrisma.__txQueryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    basePrisma.__applicationCreate.mockResolvedValueOnce({
      id: APP_ID,
      applicationNumber: 'A-202605-00001',
      submittedAt: NOW,
    });
    basePrisma.__answerCreateMany.mockResolvedValueOnce({ count: 2 });
    basePrisma.__resumeUpdateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.__portfolioUpdateMany.mockResolvedValueOnce({ count: 0 });
    basePrisma.__draftDelete.mockResolvedValueOnce({});
    basePrisma.__historyCreate.mockResolvedValueOnce({});

    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });

    expect(basePrisma.__resumeUpdateMany).toHaveBeenCalledWith({
      where: { draftId: DRAFT_ID, applicationId: null },
      data: { applicationId: APP_ID, draftId: null },
    });
    expect(basePrisma.__portfolioUpdateMany).toHaveBeenCalledWith({
      where: { draftId: DRAFT_ID, applicationId: null },
      data: { applicationId: APP_ID, draftId: null },
    });
    expect(basePrisma.__draftDelete).toHaveBeenCalledWith({ where: { id: DRAFT_ID } });
    expect(basePrisma.__historyCreate).toHaveBeenCalledWith({
      data: {
        applicationId: APP_ID,
        fromStage: null,
        toStage: StageType.SUBMITTED,
        changedByUserId: null,
      },
    });
  });

  it('확인 이메일 fire-and-forget (트랜잭션 외부)', async () => {
    setupValidatePass();
    basePrisma.__txQueryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    basePrisma.__applicationCreate.mockResolvedValueOnce({
      id: APP_ID,
      applicationNumber: 'A-202605-00001',
      submittedAt: NOW,
    });
    basePrisma.__answerCreateMany.mockResolvedValueOnce({ count: 2 });
    basePrisma.__resumeUpdateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.__portfolioUpdateMany.mockResolvedValueOnce({ count: 0 });
    basePrisma.__draftDelete.mockResolvedValueOnce({});
    basePrisma.__historyCreate.mockResolvedValueOnce({});

    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });

    // fire-and-forget — sendMail이 호출되었는지만 검증 (await 안 함)
    await new Promise((r) => setImmediate(r)); // microtask flush
    expect(sendMail).toHaveBeenCalled();
  });

  it('이메일 발송 실패해도 응답 정상 (catch silent)', async () => {
    setupValidatePass();
    basePrisma.__txQueryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    basePrisma.__applicationCreate.mockResolvedValueOnce({
      id: APP_ID,
      applicationNumber: 'A-202605-00001',
      submittedAt: NOW,
    });
    basePrisma.__answerCreateMany.mockResolvedValueOnce({ count: 2 });
    basePrisma.__resumeUpdateMany.mockResolvedValueOnce({ count: 1 });
    basePrisma.__portfolioUpdateMany.mockResolvedValueOnce({ count: 0 });
    basePrisma.__draftDelete.mockResolvedValueOnce({});
    basePrisma.__historyCreate.mockResolvedValueOnce({});
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    expect(result.applicationNumber).toBe('A-202605-00001');
  });
});

describe('submitApplication — P2002 매핑 (L-030)', () => {
  it('partial UNIQUE 충돌 → APP_ALREADY_SUBMITTED', async () => {
    setupValidatePass();
    basePrisma.__txQueryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'uk_applications_active' },
    });
    basePrisma.__applicationCreate.mockRejectedValueOnce(p2002);

    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_ALREADY_SUBMITTED' });
  });

  it('application_number 충돌 → SYS_DEPENDENCY_UNAVAILABLE', async () => {
    setupValidatePass();
    basePrisma.__txQueryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['application_number'] },
    });
    basePrisma.__applicationCreate.mockRejectedValueOnce(p2002);

    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'SYS_DEPENDENCY_UNAVAILABLE' });
  });

  it('non-P2002 에러는 그대로 throw', async () => {
    setupValidatePass();
    basePrisma.__txQueryRaw.mockResolvedValueOnce([{ last_seq: 1 }]);
    basePrisma.__applicationCreate.mockRejectedValueOnce(new Error('db down'));
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toThrow('db down');
  });
});

describe('submitApplication — 검증 실패 시 트랜잭션 미진입', () => {
  it('이메일 미인증 → AUTH_EMAIL_NOT_VERIFIED + $transaction 미호출', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: null });
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'AUTH_EMAIL_NOT_VERIFIED' });
    expect(basePrisma.$transaction).not.toHaveBeenCalled();
  });

  it('Draft 미존재 → APP_DRAFT_NOT_FOUND + $transaction 미호출', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
      id: JOB_POSTING_ID,
      status: JobStatus.OPEN,
      closesAt: FUTURE,
    });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_DRAFT_NOT_FOUND' });
    expect(basePrisma.$transaction).not.toHaveBeenCalled();
  });
});
