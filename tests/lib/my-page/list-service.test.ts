// CANDID-019 Step 1 — getMyApplicationsList 단위 테스트.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ApplicationResult, JobStatus, StageType } from '@prisma/client';

vi.mock('@/lib/prisma', () => {
  const draftFindMany = vi.fn();
  const applicationFindMany = vi.fn();
  return {
    basePrisma: {
      applicationDraft: { findMany: draftFindMany },
      application: { findMany: applicationFindMany },
    },
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    applicationDraft: { findMany: Mock };
    application: { findMany: Mock };
  };
};

const { getMyApplicationsList } = await import('@/lib/my-page/list-service');

const USER_ID = 42;

beforeEach(() => {
  vi.clearAllMocks();
  basePrisma.applicationDraft.findMany.mockResolvedValue([]);
  basePrisma.application.findMany.mockResolvedValue([]);
});

function mkAppRow(overrides: Partial<{
  id: number;
  applicationNumber: string;
  jobPostingId: number;
  currentStage: StageType;
  result: ApplicationResult;
  submittedAt: Date;
  withdrawnAt: Date | null;
  jobTitle: string;
  history: Array<{ changedAt: Date }>;
}>) {
  return {
    id: overrides.id ?? 100,
    applicationNumber: overrides.applicationNumber ?? 'A-202605-00001',
    jobPostingId: overrides.jobPostingId ?? 1,
    currentStage: overrides.currentStage ?? StageType.SUBMITTED,
    result: overrides.result ?? ApplicationResult.IN_PROGRESS,
    submittedAt: overrides.submittedAt ?? new Date('2026-05-01T00:00:00Z'),
    withdrawnAt: overrides.withdrawnAt ?? null,
    jobPosting: { id: overrides.jobPostingId ?? 1, title: overrides.jobTitle ?? '백엔드 엔지니어' },
    statusHistories: overrides.history ?? [],
  };
}

describe('getMyApplicationsList — 빈 응답', () => {
  it('drafts/inProgress/closed 모두 빈 배열 (null 금지)', async () => {
    const result = await getMyApplicationsList(USER_ID);
    expect(result).toEqual({ drafts: [], inProgress: [], closed: [] });
    expect(basePrisma.applicationDraft.findMany).toHaveBeenCalledTimes(1);
    expect(basePrisma.application.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('getMyApplicationsList — drafts 섹션', () => {
  it('draft 카드 정상 매핑 + jobStatus 포함', async () => {
    basePrisma.applicationDraft.findMany.mockResolvedValueOnce([
      {
        id: 7,
        jobPostingId: 1,
        lastSavedAt: new Date('2026-05-20T10:00:00Z'),
        jobPosting: { id: 1, title: '프론트엔드 엔지니어', status: JobStatus.OPEN },
      },
    ]);

    const result = await getMyApplicationsList(USER_ID);
    expect(result.drafts).toEqual([
      {
        draftId: 7,
        jobPostingId: 1,
        jobTitle: '프론트엔드 엔지니어',
        jobStatus: 'OPEN',
        lastSavedAt: '2026-05-20T10:00:00.000Z',
      },
    ]);
  });

  it('draft findMany 호출 인자 — userId만 필터 + lastSavedAt desc', async () => {
    await getMyApplicationsList(USER_ID);
    const callArg = basePrisma.applicationDraft.findMany.mock.calls[0]?.[0];
    expect(callArg.where).toEqual({ userId: USER_ID });
    expect(callArg.orderBy).toEqual({ lastSavedAt: 'desc' });
  });
});

describe('getMyApplicationsList — inProgress 섹션', () => {
  it('IN_PROGRESS 카드 매핑 + 상태 변경일은 statusHistories 최신 changedAt', async () => {
    basePrisma.application.findMany.mockResolvedValueOnce([
      mkAppRow({
        id: 100,
        currentStage: StageType.DOC_REVIEW,
        result: ApplicationResult.IN_PROGRESS,
        submittedAt: new Date('2026-05-01T00:00:00Z'),
        history: [{ changedAt: new Date('2026-05-10T00:00:00Z') }],
      }),
    ]);
    basePrisma.application.findMany.mockResolvedValueOnce([]); // closed

    const result = await getMyApplicationsList(USER_ID);
    expect(result.inProgress).toHaveLength(1);
    const card = result.inProgress[0]!;
    expect(card).toEqual({
      applicationId: 100,
      applicationNumber: 'A-202605-00001',
      jobPostingId: 1,
      jobTitle: '백엔드 엔지니어',
      currentStage: 'DOC_REVIEW',
      currentStageLabel: '서류 검토 중',
      result: 'IN_PROGRESS',
      submittedAt: '2026-05-01T00:00:00.000Z',
      withdrawnAt: null,
      lastStatusChangedAt: '2026-05-10T00:00:00.000Z',
    });
  });

  it('상태 변경일 — visible 이력 없으면 submittedAt 폴백', async () => {
    basePrisma.application.findMany.mockResolvedValueOnce([
      mkAppRow({
        submittedAt: new Date('2026-04-01T00:00:00Z'),
        history: [],
      }),
    ]);
    basePrisma.application.findMany.mockResolvedValueOnce([]);

    const result = await getMyApplicationsList(USER_ID);
    expect(result.inProgress[0]?.lastStatusChangedAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('inProgress 쿼리 인자 — result=IN_PROGRESS + submittedAt desc + visible filter', async () => {
    await getMyApplicationsList(USER_ID);
    const inProgressCall = basePrisma.application.findMany.mock.calls[0]?.[0];
    expect(inProgressCall.where).toEqual({ userId: USER_ID, result: ApplicationResult.IN_PROGRESS });
    expect(inProgressCall.orderBy).toEqual({ submittedAt: 'desc' });
    // statusHistories visible 필터 + take 1
    expect(inProgressCall.select.statusHistories).toMatchObject({
      where: { visibleToCandidate: true },
      take: 1,
    });
  });
});

describe('getMyApplicationsList — closed 섹션', () => {
  it('PASSED/FAILED/WITHDRAWN 모두 closed에 매핑', async () => {
    basePrisma.application.findMany.mockResolvedValueOnce([]); // inProgress
    basePrisma.application.findMany.mockResolvedValueOnce([
      mkAppRow({ id: 1, result: ApplicationResult.PASSED, currentStage: StageType.HIRED }),
      mkAppRow({ id: 2, result: ApplicationResult.FAILED, currentStage: StageType.REJECTED }),
      mkAppRow({
        id: 3,
        result: ApplicationResult.WITHDRAWN,
        currentStage: StageType.INTERVIEW_1,
        withdrawnAt: new Date('2026-05-15T00:00:00Z'),
      }),
    ]);

    const result = await getMyApplicationsList(USER_ID);
    expect(result.closed).toHaveLength(3);
    expect(result.closed.map((c) => c.result)).toEqual(['PASSED', 'FAILED', 'WITHDRAWN']);
    expect(result.closed[2]?.withdrawnAt).toBe('2026-05-15T00:00:00.000Z');
  });

  it('closed 쿼리 — result IN (PASSED, FAILED, WITHDRAWN) + 정렬 withdrawnAt desc → submittedAt desc', async () => {
    await getMyApplicationsList(USER_ID);
    const closedCall = basePrisma.application.findMany.mock.calls[1]?.[0];
    expect(closedCall.where.result).toEqual({
      in: [ApplicationResult.PASSED, ApplicationResult.FAILED, ApplicationResult.WITHDRAWN],
    });
    expect(closedCall.orderBy).toEqual([
      { withdrawnAt: 'desc' },
      { submittedAt: 'desc' },
    ]);
  });
});

describe('getMyApplicationsList — PII select 화이트리스트 회귀 가드 (L-006)', () => {
  it('Application select에 PII snapshot 컬럼이 포함되지 않음', async () => {
    await getMyApplicationsList(USER_ID);
    for (const call of basePrisma.application.findMany.mock.calls) {
      const select = call[0].select;
      // PII snapshot 5쌍이 select에 없어야 함 (자연 응답 미노출)
      expect(select).not.toHaveProperty('applicantNameSnapshot');
      expect(select).not.toHaveProperty('applicantEmailSnapshot');
      expect(select).not.toHaveProperty('phoneSnapshot');
      expect(select).not.toHaveProperty('birthDateSnapshot');
      expect(select).not.toHaveProperty('addressSnapshot');
      expect(select).not.toHaveProperty('applicantNameSnapshotKeyVersion');
      expect(select).not.toHaveProperty('applicantEmailSnapshotKeyVersion');
      expect(select).not.toHaveProperty('phoneSnapshotKeyVersion');
      expect(select).not.toHaveProperty('birthDateSnapshotKeyVersion');
      expect(select).not.toHaveProperty('addressSnapshotKeyVersion');
    }
  });

  it('statusHistories select에 changedByUserId 컬럼이 포함되지 않음 (어드민 식별자 차단)', async () => {
    await getMyApplicationsList(USER_ID);
    for (const call of basePrisma.application.findMany.mock.calls) {
      const historySelect = call[0].select.statusHistories.select;
      expect(historySelect).not.toHaveProperty('changedByUserId');
    }
  });

  it('응답 직렬화에 PII 패턴(전화/이메일/생년월일) 부재', async () => {
    basePrisma.application.findMany.mockResolvedValueOnce([
      mkAppRow({ id: 100 }),
    ]);
    const result = await getMyApplicationsList(USER_ID);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/); // phone
    expect(serialized).not.toContain('@'); // email
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T?$/m); // birthDate-like alone
  });
});

describe('getMyApplicationsList — 정렬 분리 회귀 가드', () => {
  it('inProgress와 closed는 별도 호출 (단일 호출로 합치지 않음)', async () => {
    await getMyApplicationsList(USER_ID);
    expect(basePrisma.application.findMany).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = basePrisma.application.findMany.mock.calls;
    expect(firstCall![0].where.result).toBe(ApplicationResult.IN_PROGRESS);
    expect(secondCall![0].where.result).toEqual({
      in: [ApplicationResult.PASSED, ApplicationResult.FAILED, ApplicationResult.WITHDRAWN],
    });
  });
});
