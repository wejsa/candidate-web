import 'server-only';
import { JobStatus, StageType } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { maskName } from '@/lib/pii/mask';

// CANDID-054 FR-003 — 운영 대시보드 홈 전사 요약. 운영자 첫 진입에서 채용 현황 스냅샷 제공.
//   전부 카운트/식별 단서(마스킹)만 산출 — 평문 PII 미접촉(basePrisma), groupBy + 경량 findMany 병렬.
//   가드는 호출측 페이지(requireOperatorPage)가 담당 — 본 모듈은 read 전용(인가 미수행).

const RECENT_LIMIT = 8;

// 초기 미처리 큐 = 운영자 조치 대기 단계(제출 직후 + 서류 검토). 운영 우선순위 신호.
const PENDING_STAGES: StageType[] = [StageType.SUBMITTED, StageType.DOC_REVIEW];

export interface RecentApplication {
  applicationId: number;
  applicationNumber: string;
  jobPostingId: number;
  jobTitle: string;
  currentStage: StageType;
  submittedAt: Date;
  /** 마스킹된 식별 단서 — 평문 아님. */
  applicantNameMasked: string | null;
}

export interface AdminDashboardSummary {
  postings: { total: number; byStatus: Record<JobStatus, number> };
  applications: { total: number; byStage: Record<StageType, number> };
  /** 운영자 조치 대기(SUBMITTED + DOC_REVIEW) 합. */
  pendingQueue: number;
  recent: RecentApplication[];
}

function zeroFilled<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

/** 운영 대시보드 홈 요약 — 공고 상태별/지원 단계별 카운트 + 미처리 큐 + 최근 지원(마스킹). */
export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const [postingGroups, stageGroups, recentRows] = await Promise.all([
    basePrisma.jobPosting.groupBy({ by: ['status'], _count: { _all: true } }),
    basePrisma.application.groupBy({ by: ['currentStage'], _count: { _all: true } }),
    basePrisma.application.findMany({
      orderBy: { submittedAt: 'desc' },
      take: RECENT_LIMIT,
      // PII snapshot 미선택 — User.name(평문)만 조인 후 마스킹. 이메일 등 추가 PII 미노출.
      select: {
        id: true,
        applicationNumber: true,
        jobPostingId: true,
        currentStage: true,
        submittedAt: true,
        user: { select: { name: true } },
        jobPosting: { select: { title: true } },
      },
    }),
  ]);

  const byStatus = zeroFilled(Object.values(JobStatus));
  for (const g of postingGroups) {
    byStatus[g.status] = g._count._all;
  }
  const byStage = zeroFilled(Object.values(StageType));
  for (const g of stageGroups) {
    byStage[g.currentStage] = g._count._all;
  }

  const postingsTotal = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const applicationsTotal = Object.values(byStage).reduce((sum, n) => sum + n, 0);
  const pendingQueue = PENDING_STAGES.reduce((sum, s) => sum + byStage[s], 0);

  return {
    postings: { total: postingsTotal, byStatus },
    applications: { total: applicationsTotal, byStage },
    pendingQueue,
    recent: recentRows.map((r) => ({
      applicationId: r.id,
      applicationNumber: r.applicationNumber,
      jobPostingId: r.jobPostingId,
      jobTitle: r.jobPosting.title,
      currentStage: r.currentStage,
      submittedAt: r.submittedAt,
      applicantNameMasked: maskName(r.user.name),
    })),
  };
}
