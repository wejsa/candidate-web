// CANDID-014 Step 3 — lib/jobs/apply-cta 단위 테스트.
// 5-state 분기 우선순위 + DB 호출 최소화 + Promise.all 병렬 검증.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const applicationFindFirst = vi.fn();
  const draftFindUnique = vi.fn();
  return {
    basePrisma: {
      application: { findFirst: applicationFindFirst },
      applicationDraft: { findUnique: draftFindUnique },
    },
    prisma: {
      application: { findFirst: applicationFindFirst },
      applicationDraft: { findUnique: draftFindUnique },
    },
  };
});

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    application: { findFirst: Mock };
    applicationDraft: { findUnique: Mock };
  };
};
const { resolveApplyCta } = await import('@/lib/jobs/apply-cta');

const JOB_OPEN = { id: 42, isClosed: false };
const JOB_CLOSED = { id: 42, isClosed: true };

beforeEach(() => {
  basePrisma.application.findFirst.mockReset();
  basePrisma.applicationDraft.findUnique.mockReset();
});

describe('resolveApplyCta — 우선순위 1: 마감', () => {
  it('마감 공고 + 비로그인 → CLOSED (DB 조회 0)', async () => {
    const result = await resolveApplyCta({ userId: null, job: JOB_CLOSED });
    expect(result).toEqual({ state: 'CLOSED' });
    expect(basePrisma.application.findFirst).not.toHaveBeenCalled();
    expect(basePrisma.applicationDraft.findUnique).not.toHaveBeenCalled();
  });

  it('마감 공고 + 로그인 → CLOSED (DB 조회 0)', async () => {
    const result = await resolveApplyCta({ userId: 1, job: JOB_CLOSED });
    expect(result).toEqual({ state: 'CLOSED' });
    expect(basePrisma.application.findFirst).not.toHaveBeenCalled();
    expect(basePrisma.applicationDraft.findUnique).not.toHaveBeenCalled();
  });
});

describe('resolveApplyCta — 우선순위 2: 비로그인', () => {
  it('미마감 + 비로그인 → GUEST (DB 조회 0)', async () => {
    const result = await resolveApplyCta({ userId: null, job: JOB_OPEN });
    expect(result).toEqual({ state: 'GUEST' });
    expect(basePrisma.application.findFirst).not.toHaveBeenCalled();
    expect(basePrisma.applicationDraft.findUnique).not.toHaveBeenCalled();
  });
});

describe('resolveApplyCta — 우선순위 3: 이미 지원', () => {
  it('활성 지원서 존재 → ALREADY_APPLIED + applicationNumber 반환', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce({ applicationNumber: 'A-202605-00042' });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    const result = await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    expect(result).toEqual({ state: 'ALREADY_APPLIED', applicationNumber: 'A-202605-00042' });
  });

  it('application.findFirst의 where는 result != WITHDRAWN (uk_applications_active 부분 UNIQUE 활용)', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce({ applicationNumber: 'A-1' });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    const arg = basePrisma.application.findFirst.mock.calls[0]![0];
    expect(arg.where).toMatchObject({
      userId: 100,
      jobPostingId: 42,
      result: { not: 'WITHDRAWN' },
    });
  });

  it('이미 지원이 있어도 draft도 동시 조회됨 (Promise.all 병렬)', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce({ applicationNumber: 'A-1' });
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: 7 });
    await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    expect(basePrisma.application.findFirst).toHaveBeenCalledTimes(1);
    expect(basePrisma.applicationDraft.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('resolveApplyCta — 우선순위 4: 임시저장', () => {
  it('application 없음 + draft 있음 → RESUME_DRAFT', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(null);
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: 7 });
    const result = await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    expect(result).toEqual({ state: 'RESUME_DRAFT' });
  });

  it('draft 조회는 uk_drafts_user_posting UNIQUE 키 사용', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(null);
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: 7 });
    await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    const arg = basePrisma.applicationDraft.findUnique.mock.calls[0]![0];
    expect(arg.where).toEqual({ userId_jobPostingId: { userId: 100, jobPostingId: 42 } });
  });
});

describe('resolveApplyCta — 우선순위 5: 신규 지원', () => {
  it('application 없음 + draft 없음 → APPLY', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(null);
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    const result = await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    expect(result).toEqual({ state: 'APPLY' });
  });
});

describe('resolveApplyCta — WITHDRAWN 처리', () => {
  it('WITHDRAWN만 있는 사용자 → fall-through (draft/없음 분기 진입)', async () => {
    // findFirst의 where가 result: { not: 'WITHDRAWN' }이라 WITHDRAWN은 null로 응답
    basePrisma.application.findFirst.mockResolvedValueOnce(null);
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce(null);
    const result = await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    expect(result.state).toBe('APPLY');
  });

  it('WITHDRAWN + draft 존재 → RESUME_DRAFT (재지원 시나리오)', async () => {
    basePrisma.application.findFirst.mockResolvedValueOnce(null);
    basePrisma.applicationDraft.findUnique.mockResolvedValueOnce({ id: 7 });
    const result = await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    expect(result.state).toBe('RESUME_DRAFT');
  });
});

describe('resolveApplyCta — Promise.all 병렬 호출 회귀 가드', () => {
  it('application과 draft가 동시에 호출됨 (직렬 호출 회귀 차단)', async () => {
    let applicationStartedAt = 0;
    let draftStartedAt = 0;
    basePrisma.application.findFirst.mockImplementationOnce(async () => {
      applicationStartedAt = Date.now();
      await new Promise((r) => setTimeout(r, 10));
      return null;
    });
    basePrisma.applicationDraft.findUnique.mockImplementationOnce(async () => {
      draftStartedAt = Date.now();
      await new Promise((r) => setTimeout(r, 10));
      return null;
    });
    await resolveApplyCta({ userId: 100, job: JOB_OPEN });
    // 병렬이면 두 시작 시점이 거의 동일 (직렬이면 >10ms 차이)
    expect(Math.abs(applicationStartedAt - draftStartedAt)).toBeLessThan(8);
  });
});
