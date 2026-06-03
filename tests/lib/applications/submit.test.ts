// CANDID-018 Step 2 — submitApplication 단위 테스트 (Prisma mock).
// PR #68 review fix loop 1: encryptApplicationPiiSnapshotInput 사용 + PII snapshot 단언 +
// extractAnswerRows boundary + tx rollback 후속 미호출 단언.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma, StageType, JobStatus } from '@prisma/client';

vi.mock('@/lib/prisma', () => {
  const baseUserFindUnique = vi.fn();
  const baseJobFindUnique = vi.fn();
  const baseDraftFindUnique = vi.fn();
  const baseResumeCount = vi.fn();
  const wrappedUserFindUnique = vi.fn();
  const applicationCreate = vi.fn();
  const answerCreateMany = vi.fn();
  const resumeUpdateMany = vi.fn();
  const portfolioUpdateMany = vi.fn();
  const draftDelete = vi.fn();
  const historyCreate = vi.fn();
  const txJobFindUnique = vi.fn();
  const $transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      jobPosting: { findUnique: txJobFindUnique },
      application: { create: applicationCreate },
      applicationAnswer: { createMany: answerCreateMany },
      resumeFile: { updateMany: resumeUpdateMany },
      portfolioLink: { updateMany: portfolioUpdateMany },
      applicationDraft: { delete: draftDelete },
      applicationStatusHistory: { create: historyCreate },
    }),
  );
  return {
    basePrisma: {
      user: { findUnique: baseUserFindUnique },
      jobPosting: { findUnique: baseJobFindUnique },
      applicationDraft: { findUnique: baseDraftFindUnique },
      resumeFile: { count: baseResumeCount },
      // issueApplicationNumber default client
      $queryRaw: vi.fn().mockResolvedValue([{ last_seq: 1 }]),
      applicationNumberSequence: { create: vi.fn() },
    },
    prisma: {
      user: { findUnique: wrappedUserFindUnique },
      $transaction,
      __txJobFindUnique: txJobFindUnique,
      __applicationCreate: applicationCreate,
      __answerCreateMany: answerCreateMany,
      __resumeUpdateMany: resumeUpdateMany,
      __portfolioUpdateMany: portfolioUpdateMany,
      __draftDelete: draftDelete,
      __historyCreate: historyCreate,
    },
  };
});

vi.mock('@/lib/email/transport', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/audit/record', () => ({ recordAuditEvent: vi.fn() }));

// encryptApplicationPiiSnapshotInput 결정적 mock (실제 정규화 호출 단언 가능)
vi.mock('@/lib/prisma/extends', async () => {
  const actual = await vi.importActual<typeof import('@/lib/prisma/extends')>(
    '@/lib/prisma/extends',
  );
  return {
    ...actual,
    encryptApplicationPiiSnapshotInput: vi.fn((input: Record<string, string | null>) => {
      const result: Record<string, Uint8Array | number | null | undefined> = {};
      for (const [key, value] of Object.entries(input)) {
        if (value === null || value === undefined || value === '') {
          result[key] = null;
        } else {
          result[key] = new Uint8Array([0x01, 0x02, 0x03]);
          result[`${key}KeyVersion`] = 1;
        }
      }
      return result;
    }),
  };
});

const { basePrisma, prisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    user: { findUnique: Mock };
    jobPosting: { findUnique: Mock };
    applicationDraft: { findUnique: Mock };
    resumeFile: { count: Mock };
  };
  prisma: {
    user: { findUnique: Mock };
    $transaction: Mock;
    __txJobFindUnique: Mock;
    __applicationCreate: Mock;
    __answerCreateMany: Mock;
    __resumeUpdateMany: Mock;
    __portfolioUpdateMany: Mock;
    __draftDelete: Mock;
    __historyCreate: Mock;
  };
};
const { sendMail } = (await import('@/lib/email/transport')) as unknown as { sendMail: Mock };
const { recordAuditEvent } = (await import('@/lib/audit/record')) as unknown as {
  recordAuditEvent: Mock;
};
const { submitApplication } = await import('@/lib/applications/submit');

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
    '10': '답변 1',
    '11': ['option_a', 'option_b'],
  },
};

beforeEach(() => {
  basePrisma.user.findUnique.mockReset();
  basePrisma.jobPosting.findUnique.mockReset();
  basePrisma.applicationDraft.findUnique.mockReset();
  basePrisma.resumeFile.count.mockReset();
  prisma.user.findUnique.mockReset();
  prisma.__txJobFindUnique.mockReset();
  prisma.__applicationCreate.mockReset();
  prisma.__answerCreateMany.mockReset();
  prisma.__resumeUpdateMany.mockReset();
  prisma.__portfolioUpdateMany.mockReset();
  prisma.__draftDelete.mockReset();
  prisma.__historyCreate.mockReset();
  prisma.$transaction.mockClear();
  sendMail.mockClear();
  sendMail.mockResolvedValue(undefined);
});

function setupValidatePass(payload: unknown = COMPLETE_PAYLOAD) {
  basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date('2026-04-01') });
  basePrisma.jobPosting.findUnique.mockResolvedValueOnce({
    id: JOB_POSTING_ID,
    status: JobStatus.OPEN,
    closesAt: FUTURE,
  });
  basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({
    id: DRAFT_ID,
    payloadJson: payload,
  });
  basePrisma.resumeFile.count.mockResolvedValueOnce(1);
  prisma.user.findUnique.mockResolvedValueOnce({
    email: 'user@example.com',
    name: '홍길동',
    phone: '010-1234-5678',
    birthDate: '1995-03-15',
  });
}

function setupTxSuccess() {
  prisma.__txJobFindUnique.mockResolvedValueOnce({ status: JobStatus.OPEN, closesAt: FUTURE });
  prisma.__applicationCreate.mockResolvedValueOnce({
    id: APP_ID,
    applicationNumber: 'A-202605-00001',
    submittedAt: NOW,
  });
  prisma.__answerCreateMany.mockResolvedValueOnce({ count: 2 });
  prisma.__resumeUpdateMany.mockResolvedValueOnce({ count: 1 });
  prisma.__portfolioUpdateMany.mockResolvedValueOnce({ count: 0 });
  prisma.__draftDelete.mockResolvedValueOnce({});
  prisma.__historyCreate.mockResolvedValueOnce({});
}

describe('submitApplication — happy path', () => {
  it('정상 제출 → application_number + submittedAt + currentStage', async () => {
    setupValidatePass();
    setupTxSuccess();
    const result = await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    expect(result.applicationNumber).toBe('A-202605-00001');
    expect(result.currentStage).toBe('SUBMITTED');
    expect(result.submittedAt).toBe(NOW.toISOString());
  });

  // CANDID-026 Step 3 — APPLICATION_SUBMIT 감사를 트랜잭션 내부(tx)에서 emit (BR-TX-01).
  it('APPLICATION_SUBMIT 감사를 tx로 emit (applicationNumber metadata)', async () => {
    setupValidatePass();
    setupTxSuccess();
    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'APPLICATION_SUBMIT',
        actorUserId: USER_ID,
        resourceType: 'application',
        resourceId: String(APP_ID),
        metadata: { applicationNumber: 'A-202605-00001' },
      }),
      expect.objectContaining({ tx: expect.anything() }),
    );
  });

  it('PII snapshot 4쌍 컬럼이 ciphertext + keyVersion=1 (BR-PII-03 회귀 가드)', async () => {
    setupValidatePass();
    setupTxSuccess();
    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    const createCall = prisma.__applicationCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    const expectedBytes = new Uint8Array([0x01, 0x02, 0x03]);
    expect(createCall.data.applicantNameSnapshot).toEqual(expectedBytes);
    expect(createCall.data.applicantNameSnapshotKeyVersion).toBe(1);
    expect(createCall.data.applicantEmailSnapshot).toEqual(expectedBytes);
    expect(createCall.data.applicantEmailSnapshotKeyVersion).toBe(1);
    expect(createCall.data.phoneSnapshot).toEqual(expectedBytes);
    expect(createCall.data.phoneSnapshotKeyVersion).toBe(1);
    expect(createCall.data.birthDateSnapshot).toEqual(expectedBytes);
    expect(createCall.data.birthDateSnapshotKeyVersion).toBe(1);
    // 평문 누출 회귀 가드
    const dataStr = JSON.stringify(createCall.data, (_, v) =>
      v instanceof Uint8Array ? Array.from(v) : v,
    );
    expect(dataStr).not.toContain('010-1234-5678');
    expect(dataStr).not.toContain('1995-03-15');
    expect(dataStr).not.toContain('user@example.com');
    expect(dataStr).not.toContain('홍길동');
  });

  it('changedByUserId=userId 본인 actor 기록 (D-H006)', async () => {
    setupValidatePass();
    setupTxSuccess();
    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    expect(prisma.__historyCreate).toHaveBeenCalledWith({
      data: {
        applicationId: APP_ID,
        fromStage: null,
        toStage: StageType.SUBMITTED,
        changedByUserId: USER_ID,
      },
    });
  });

  it('answers 일괄 생성 (string + array 두 타입)', async () => {
    setupValidatePass();
    setupTxSuccess();
    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    const call = prisma.__answerCreateMany.mock.calls[0]?.[0] as {
      data: { applicationId: number; questionId: number; answerText: string | null }[];
    };
    expect(call.data).toHaveLength(2);
    expect(call.data.find((r) => r.questionId === 10)?.answerText).toBe('답변 1');
    expect(call.data.find((r) => r.questionId === 11)?.answerText).toBeNull();
  });

  it('resume/portfolio draft_id → application_id 이전 + Draft 삭제', async () => {
    setupValidatePass();
    setupTxSuccess();
    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    expect(prisma.__resumeUpdateMany).toHaveBeenCalledWith({
      where: { draftId: DRAFT_ID, applicationId: null },
      data: { applicationId: APP_ID, draftId: null },
    });
    expect(prisma.__portfolioUpdateMany).toHaveBeenCalledWith({
      where: { draftId: DRAFT_ID, applicationId: null },
      data: { applicationId: APP_ID, draftId: null },
    });
    expect(prisma.__draftDelete).toHaveBeenCalledWith({ where: { id: DRAFT_ID } });
  });

  it('이메일 fire-and-forget (트랜잭션 외부)', async () => {
    setupValidatePass();
    setupTxSuccess();
    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    await new Promise((r) => setImmediate(r)); // fire-and-forget void promise 완료 대기
    expect(sendMail).toHaveBeenCalled();
  });

  it('이메일 발송 실패해도 응답 정상', async () => {
    setupValidatePass();
    setupTxSuccess();
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    const result = await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    expect(result.applicationNumber).toBe('A-202605-00001');
  });
});

describe('submitApplication — tx 내부 마감 재검증 (D-H001 TOCTOU)', () => {
  it('tx 진입 시점 마감 지나면 APP_DEADLINE_PASSED + create 미호출', async () => {
    setupValidatePass();
    const PAST = new Date(NOW.getTime() - 1);
    prisma.__txJobFindUnique.mockResolvedValueOnce({ status: JobStatus.OPEN, closesAt: PAST });
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_DEADLINE_PASSED' });
    expect(prisma.__applicationCreate).not.toHaveBeenCalled();
  });

  it('tx 진입 시점 공고 CLOSED면 JOB_NOT_FOUND', async () => {
    setupValidatePass();
    prisma.__txJobFindUnique.mockResolvedValueOnce({ status: JobStatus.CLOSED, closesAt: FUTURE });
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
    expect(prisma.__applicationCreate).not.toHaveBeenCalled();
  });
});

describe('submitApplication — P2002 매핑 (D-H002 화이트리스트)', () => {
  it('uk_applications_active → APP_ALREADY_SUBMITTED + 후속 미호출 (BR-TX-01)', async () => {
    setupValidatePass();
    prisma.__txJobFindUnique.mockResolvedValueOnce({ status: JobStatus.OPEN, closesAt: FUTURE });
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'uk_applications_active' },
    });
    prisma.__applicationCreate.mockRejectedValueOnce(p2002);
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'APP_ALREADY_SUBMITTED' });
    expect(prisma.__answerCreateMany).not.toHaveBeenCalled();
    expect(prisma.__resumeUpdateMany).not.toHaveBeenCalled();
    expect(prisma.__portfolioUpdateMany).not.toHaveBeenCalled();
    expect(prisma.__draftDelete).not.toHaveBeenCalled();
    expect(prisma.__historyCreate).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('application_number → SYS_DEPENDENCY_UNAVAILABLE', async () => {
    setupValidatePass();
    prisma.__txJobFindUnique.mockResolvedValueOnce({ status: JobStatus.OPEN, closesAt: FUTURE });
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['application_number'] },
    });
    prisma.__applicationCreate.mockRejectedValueOnce(p2002);
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'SYS_DEPENDENCY_UNAVAILABLE' });
  });

  it('알 수 없는 target P2002 → 원본 throw (false positive 회피)', async () => {
    setupValidatePass();
    prisma.__txJobFindUnique.mockResolvedValueOnce({ status: JobStatus.OPEN, closesAt: FUTURE });
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'uk_some_other_index' },
    });
    prisma.__applicationCreate.mockRejectedValueOnce(p2002);
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('non-P2002 에러는 그대로 throw', async () => {
    setupValidatePass();
    prisma.__txJobFindUnique.mockResolvedValueOnce({ status: JobStatus.OPEN, closesAt: FUTURE });
    prisma.__applicationCreate.mockRejectedValueOnce(new Error('db down'));
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toThrow('db down');
  });
});

describe('submitApplication — 검증 실패 시 tx 미진입', () => {
  it('이메일 미인증 → AUTH_EMAIL_NOT_VERIFIED + $transaction 미호출', async () => {
    basePrisma.user.findUnique.mockResolvedValueOnce({ emailVerifiedAt: null });
    await expect(
      submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW }),
    ).rejects.toMatchObject({ code: 'AUTH_EMAIL_NOT_VERIFIED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('extractAnswerRows — silent skip boundary', () => {
  it('NaN key / 음수 / number-value / object-value 모두 skip (string/array만 row)', async () => {
    setupValidatePass({
      ...COMPLETE_PAYLOAD,
      step3_answers: {
        '10': '유효',
        '11': ['a', 'b'],
        'abc': '키 NaN',
        '-1': '음수 키',
        '12': 42,
        '13': { foo: 'bar' },
      },
    });
    setupTxSuccess();
    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    const call = prisma.__answerCreateMany.mock.calls[0]?.[0] as { data: unknown[] };
    expect(call.data).toHaveLength(2);
  });

  it('step3_answers 빈 객체 → createMany 미호출', async () => {
    setupValidatePass({ ...COMPLETE_PAYLOAD, step3_answers: {} });
    setupTxSuccess();
    await submitApplication({ userId: USER_ID, jobPostingId: JOB_POSTING_ID, now: NOW });
    expect(prisma.__answerCreateMany).not.toHaveBeenCalled();
  });
});
