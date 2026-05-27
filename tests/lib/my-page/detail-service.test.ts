// CANDID-019 Step 2 — getMyApplicationDetail / getMyInterviewSchedule 단위 테스트.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  ApplicationResult,
  InterviewScheduleStatus,
  StageType,
} from '@prisma/client';
import { AppError, isAppError } from '@/lib/errors';

vi.mock('@/lib/prisma', () => {
  const applicationFindFirst = vi.fn();
  const interviewFindFirst = vi.fn();
  return {
    basePrisma: {
      application: { findFirst: applicationFindFirst },
      interviewSchedule: { findFirst: interviewFindFirst },
    },
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    application: { findFirst: Mock };
    interviewSchedule: { findFirst: Mock };
  };
};
const { getMyApplicationDetail, getMyInterviewSchedule } = await import(
  '@/lib/my-page/detail-service'
);

const USER_ID = 42;
const APP_ID = 100;
const SCHEDULE_ID = 7;

beforeEach(() => {
  vi.clearAllMocks();
});

function mkDetailRow(overrides: Partial<{
  histories: Array<{ id: number; fromStage: StageType | null; toStage: StageType; changedAt: Date }>;
  interviews: Array<{
    id: number;
    stage: StageType;
    scheduledAt: Date;
    locationOrUrl: string;
    status: InterviewScheduleStatus;
    icsUid: string;
  }>;
  jobTitle: string;
  withdrawnAt: Date | null;
  result: ApplicationResult;
  currentStage: StageType;
}> = {}) {
  return {
    id: APP_ID,
    applicationNumber: 'A-202605-00001',
    jobPostingId: 1,
    currentStage: overrides.currentStage ?? StageType.INTERVIEW_1,
    result: overrides.result ?? ApplicationResult.IN_PROGRESS,
    submittedAt: new Date('2026-05-01T00:00:00Z'),
    withdrawnAt: overrides.withdrawnAt ?? null,
    jobPosting: { id: 1, title: overrides.jobTitle ?? '백엔드 엔지니어' },
    statusHistories: overrides.histories ?? [],
    interviewSchedules: overrides.interviews ?? [],
  };
}

describe('getMyApplicationDetail — 정상', () => {
  it('summary/timeline/interviews 매핑 + ICS URL 생성', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(
      mkDetailRow({
        histories: [
          { id: 1, fromStage: null, toStage: StageType.SUBMITTED, changedAt: new Date('2026-05-01T00:00:00Z') },
          { id: 2, fromStage: StageType.SUBMITTED, toStage: StageType.DOC_REVIEW, changedAt: new Date('2026-05-05T00:00:00Z') },
          { id: 3, fromStage: StageType.DOC_REVIEW, toStage: StageType.INTERVIEW_1, changedAt: new Date('2026-05-10T00:00:00Z') },
        ],
        interviews: [
          {
            id: SCHEDULE_ID,
            stage: StageType.INTERVIEW_1,
            scheduledAt: new Date('2026-05-15T05:00:00Z'),
            locationOrUrl: '서울시 강남구',
            status: InterviewScheduleStatus.SCHEDULED,
            icsUid: 'iv-7@cw.example.com',
          },
        ],
      }),
    );

    const result = await getMyApplicationDetail(USER_ID, APP_ID);
    expect(result.summary.applicationId).toBe(APP_ID);
    expect(result.summary.currentStage).toBe(StageType.INTERVIEW_1);
    expect(result.summary.currentStageLabel).toBe('1차 면접');
    // lastStatusChangedAt — visible 이력 최신(asc 정렬 마지막 row)
    expect(result.summary.lastStatusChangedAt).toBe('2026-05-10T00:00:00.000Z');

    expect(result.timeline).toHaveLength(3);
    expect(result.timeline[1]).toEqual({
      id: 2,
      fromStage: StageType.SUBMITTED,
      toStage: StageType.DOC_REVIEW,
      toStageLabel: '서류 검토 중',
      changedAt: '2026-05-05T00:00:00.000Z',
    });

    expect(result.interviews).toHaveLength(1);
    expect(result.interviews[0]).toMatchObject({
      scheduleId: SCHEDULE_ID,
      stage: StageType.INTERVIEW_1,
      stageLabel: '1차 면접',
      icsDownloadUrl: `/api/v1/applications/me/${APP_ID}/interview.ics?scheduleId=${SCHEDULE_ID}`,
    });
  });

  it('이력 없으면 lastStatusChangedAt = submittedAt 폴백', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(mkDetailRow({ histories: [] }));
    const result = await getMyApplicationDetail(USER_ID, APP_ID);
    expect(result.summary.lastStatusChangedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(result.timeline).toEqual([]);
  });

  it('면접 없음 → 빈 배열', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(mkDetailRow({}));
    const result = await getMyApplicationDetail(USER_ID, APP_ID);
    expect(result.interviews).toEqual([]);
  });
});

describe('getMyApplicationDetail — ownership 강제', () => {
  it('null 반환 → AppError(APP_DRAFT_NOT_FOUND) 404 (정보 누출 회피)', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(null);
    let caught: unknown;
    try {
      await getMyApplicationDetail(USER_ID, APP_ID);
    } catch (err) {
      caught = err;
    }
    expect(isAppError(caught)).toBe(true);
    expect((caught as AppError).code).toBe('APP_DRAFT_NOT_FOUND');
    expect((caught as AppError).status).toBe(404);
  });

  it('findFirst where 절에 userId + id 필터 명시', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(mkDetailRow({}));
    await getMyApplicationDetail(USER_ID, APP_ID);
    const call = basePrisma.application.findFirst.mock.calls[0]?.[0];
    expect(call.where).toEqual({ id: APP_ID, userId: USER_ID });
  });
});

describe('getMyApplicationDetail — PII select 화이트리스트 + 어드민 식별자 차단', () => {
  it('Application select에 PII snapshot 5쌍 미포함', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(mkDetailRow({}));
    await getMyApplicationDetail(USER_ID, APP_ID);
    const select = basePrisma.application.findFirst.mock.calls[0]?.[0].select;
    expect(select).not.toHaveProperty('applicantNameSnapshot');
    expect(select).not.toHaveProperty('applicantEmailSnapshot');
    expect(select).not.toHaveProperty('phoneSnapshot');
    expect(select).not.toHaveProperty('birthDateSnapshot');
    expect(select).not.toHaveProperty('addressSnapshot');
  });

  it('statusHistories.where: visibleToCandidate=true + select에 changedByUserId 없음', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(mkDetailRow({}));
    await getMyApplicationDetail(USER_ID, APP_ID);
    const sh = basePrisma.application.findFirst.mock.calls[0]?.[0].select.statusHistories;
    expect(sh.where).toEqual({ visibleToCandidate: true });
    expect(sh.select).not.toHaveProperty('changedByUserId');
    expect(sh.orderBy).toEqual({ changedAt: 'asc' });
  });

  it('interviewSchedules.where: CANCELLED 제외', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(mkDetailRow({}));
    await getMyApplicationDetail(USER_ID, APP_ID);
    const iv = basePrisma.application.findFirst.mock.calls[0]?.[0].select.interviewSchedules;
    expect(iv.where).toEqual({ status: { not: InterviewScheduleStatus.CANCELLED } });
  });

  it('응답 직렬화에 PII 패턴(이메일/전화) 부재', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(mkDetailRow({}));
    const result = await getMyApplicationDetail(USER_ID, APP_ID);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('@');
    expect(serialized).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
  });
});

describe('getMyInterviewSchedule — ownership 강제', () => {
  it('null 반환 → AppError(APP_INTERVIEW_NOT_FOUND) 404 (review C1 fix)', async () => {
    basePrisma.interviewSchedule.findFirst.mockResolvedValueOnce(null);
    let caught: unknown;
    try {
      await getMyInterviewSchedule(USER_ID, APP_ID, SCHEDULE_ID);
    } catch (err) {
      caught = err;
    }
    expect(isAppError(caught)).toBe(true);
    expect((caught as AppError).code).toBe('APP_INTERVIEW_NOT_FOUND');
    expect((caught as AppError).status).toBe(404);
  });

  it('where 절에 ownership + status != CANCELLED 명시', async () => {
    basePrisma.interviewSchedule.findFirst.mockResolvedValueOnce({
      id: SCHEDULE_ID,
      stage: StageType.INTERVIEW_1,
      scheduledAt: new Date('2026-05-15T05:00:00Z'),
      locationOrUrl: '서울시 강남구',
      status: InterviewScheduleStatus.SCHEDULED,
      icsUid: 'iv-7@cw.example.com',
      application: {
        applicationNumber: 'A-202605-00001',
        jobPosting: { title: '백엔드 엔지니어' },
      },
    });
    await getMyInterviewSchedule(USER_ID, APP_ID, SCHEDULE_ID);
    const call = basePrisma.interviewSchedule.findFirst.mock.calls[0]?.[0];
    expect(call.where).toEqual({
      id: SCHEDULE_ID,
      applicationId: APP_ID,
      application: { userId: USER_ID },
      status: { not: InterviewScheduleStatus.CANCELLED },
    });
  });

  it('정상 반환 — applicationNumber/jobTitle 매핑', async () => {
    basePrisma.interviewSchedule.findFirst.mockResolvedValueOnce({
      id: SCHEDULE_ID,
      stage: StageType.INTERVIEW_2,
      scheduledAt: new Date('2026-05-20T05:00:00Z'),
      locationOrUrl: 'https://meet.example.com/xyz',
      status: InterviewScheduleStatus.SCHEDULED,
      icsUid: 'iv-7@cw.example.com',
      application: {
        applicationNumber: 'A-202605-00001',
        jobPosting: { title: '백엔드 엔지니어' },
      },
    });
    const result = await getMyInterviewSchedule(USER_ID, APP_ID, SCHEDULE_ID);
    expect(result.applicationNumber).toBe('A-202605-00001');
    expect(result.jobTitle).toBe('백엔드 엔지니어');
    expect(result.locationOrUrl).toBe('https://meet.example.com/xyz');
  });
});
