import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { maskName } from '@/lib/pii/mask';

// CANDID-054 FR-003 — 운영 대시보드 홈 요약 집계 단위 테스트.
// 핵심: (1) 공고/지원 0-fill + total 정합, (2) pendingQueue=SUBMITTED+DOC_REVIEW, (3) 최근 지원 마스킹(평문 미노출).

vi.mock('@/lib/prisma', () => ({
  basePrisma: {
    jobPosting: { groupBy: vi.fn() },
    application: { groupBy: vi.fn(), findMany: vi.fn() },
  },
}));

const { basePrisma } = (await import('@/lib/prisma')) as unknown as {
  basePrisma: {
    jobPosting: { groupBy: Mock };
    application: { groupBy: Mock; findMany: Mock };
  };
};
const { getAdminDashboardSummary } = await import('@/lib/admin/dashboard');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAdminDashboardSummary', () => {
  it('공고/지원 0-fill + total 정합 + pendingQueue + 최근 마스킹', async () => {
    basePrisma.jobPosting.groupBy.mockResolvedValue([
      { status: 'OPEN', _count: { _all: 3 } },
      { status: 'CLOSED', _count: { _all: 2 } },
    ]);
    basePrisma.application.groupBy.mockResolvedValue([
      { currentStage: 'SUBMITTED', _count: { _all: 4 } },
      { currentStage: 'DOC_REVIEW', _count: { _all: 3 } },
      { currentStage: 'HIRED', _count: { _all: 1 } },
    ]);
    basePrisma.application.findMany.mockResolvedValue([
      {
        id: 10,
        applicationNumber: 'A-202606-00010',
        jobPostingId: 7,
        currentStage: 'DOC_REVIEW',
        submittedAt: new Date('2026-06-05T00:00:00Z'),
        user: { name: '홍길동' },
        jobPosting: { title: '백엔드 엔지니어' },
      },
    ]);

    const s = await getAdminDashboardSummary();

    // 공고 상태 0-fill(DRAFT 미보고 → 0) + total.
    expect(s.postings.byStatus.OPEN).toBe(3);
    expect(s.postings.byStatus.CLOSED).toBe(2);
    expect(s.postings.byStatus.DRAFT).toBe(0);
    expect(s.postings.total).toBe(5);

    // 지원 단계 0-fill + total.
    expect(s.applications.byStage.SUBMITTED).toBe(4);
    expect(s.applications.byStage.DOC_REVIEW).toBe(3);
    expect(s.applications.byStage.HIRED).toBe(1);
    expect(s.applications.byStage.INTERVIEW_1).toBe(0);
    expect(s.applications.total).toBe(8);

    // 미처리 큐 = SUBMITTED + DOC_REVIEW.
    expect(s.pendingQueue).toBe(7);

    // 최근 지원 — 이름 마스킹(평문 미노출).
    expect(s.recent).toHaveLength(1);
    const r = s.recent[0]!;
    expect(r.applicantNameMasked).toBe(maskName('홍길동'));
    expect(r.applicantNameMasked).not.toBe('홍길동');
    expect(r.jobTitle).toBe('백엔드 엔지니어');
    expect(r.applicationId).toBe(10);
    // 평문 이름/이메일이 직렬화에 새지 않음.
    expect(JSON.stringify(s)).not.toContain('홍길동');

    // 최근 조회는 submittedAt desc + take 8.
    const recentCall = basePrisma.application.findMany.mock.calls[0]![0];
    expect(recentCall.orderBy).toEqual({ submittedAt: 'desc' });
    expect(recentCall.take).toBe(8);
    // 이메일 등 추가 PII 미선택(이름만).
    expect(recentCall.select.user.select).toEqual({ name: true });
  });

  it('데이터 0건 → 전 카운트 0, recent 빈 배열', async () => {
    basePrisma.jobPosting.groupBy.mockResolvedValue([]);
    basePrisma.application.groupBy.mockResolvedValue([]);
    basePrisma.application.findMany.mockResolvedValue([]);

    const s = await getAdminDashboardSummary();
    expect(s.postings.total).toBe(0);
    expect(s.applications.total).toBe(0);
    expect(s.pendingQueue).toBe(0);
    expect(s.recent).toEqual([]);
    expect(Object.values(s.postings.byStatus).every((n) => n === 0)).toBe(true);
    expect(Object.values(s.applications.byStage).every((n) => n === 0)).toBe(true);
  });
});
