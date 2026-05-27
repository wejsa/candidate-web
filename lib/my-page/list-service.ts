// CANDID-019 Step 1 — 마이페이지 리스트 서비스 (US-MY-001).
//
// 3 섹션 분리 (서버에서 분리하여 클라이언트 로직 단순화):
//   1. 작성 중 (Draft) — applicationDraft.findMany
//   2. 진행 중 — applications.result = IN_PROGRESS
//   3. 종료 — applications.result IN (PASSED, FAILED, WITHDRAWN)
//
// 보안 (L-006 3-layer 첫 레이어):
//   - Application select 화이트리스트로 PII snapshot 5쌍(10 컬럼) 자연 제외
//   - statusHistories는 visibleToCandidate=true 만 (CANDID-005 Step 3 플래그)
//   - changedByUserId 응답 제외 (어드민 식별자 노출 방지 — DB 에이전트 권장)
//
// 정렬:
//   - drafts: lastSavedAt desc
//   - inProgress: submittedAt desc
//   - closed: withdrawnAt desc → submittedAt desc (fallback)
//
// 상태 변경일 source: statusHistories(visibleToCandidate=true).orderBy(changedAt desc).take(1)
//   미존재(SUBMITTED 직후 등) 시 submittedAt 폴백.

import 'server-only';
import { ApplicationResult, type StageType } from '@prisma/client';
import { basePrisma } from '@/lib/prisma';
import { stageLabel } from '@/lib/my-page/stage-labels';
import type {
  MyApplicationCard,
  MyApplicationListResponse,
  MyDraftCard,
} from '@/lib/my-page/types';

interface ApplicationRow {
  id: number;
  applicationNumber: string;
  jobPostingId: number;
  currentStage: StageType;
  result: ApplicationResult;
  submittedAt: Date;
  withdrawnAt: Date | null;
  jobPosting: { id: number; title: string };
  statusHistories: Array<{ changedAt: Date }>;
}

const APPLICATION_SELECT = {
  id: true,
  applicationNumber: true,
  jobPostingId: true,
  currentStage: true,
  result: true,
  submittedAt: true,
  withdrawnAt: true,
  jobPosting: { select: { id: true, title: true } },
  statusHistories: {
    where: { visibleToCandidate: true },
    orderBy: { changedAt: 'desc' as const },
    take: 1,
    select: { changedAt: true },
  },
} as const;

/**
 * 마이페이지 리스트 조회 (3 섹션). 빈 섹션은 빈 배열 반환 (null/undefined 금지).
 */
export async function getMyApplicationsList(
  userId: number,
): Promise<MyApplicationListResponse> {
  const [drafts, inProgressRows, closedRows] = await Promise.all([
    basePrisma.applicationDraft.findMany({
      where: { userId },
      select: {
        id: true,
        jobPostingId: true,
        lastSavedAt: true,
        jobPosting: { select: { id: true, title: true, status: true } },
      },
      orderBy: { lastSavedAt: 'desc' },
    }),
    basePrisma.application.findMany({
      where: { userId, result: ApplicationResult.IN_PROGRESS },
      select: APPLICATION_SELECT,
      orderBy: { submittedAt: 'desc' },
    }),
    basePrisma.application.findMany({
      where: {
        userId,
        result: { in: [ApplicationResult.PASSED, ApplicationResult.FAILED, ApplicationResult.WITHDRAWN] },
      },
      select: APPLICATION_SELECT,
      orderBy: [{ withdrawnAt: 'desc' }, { submittedAt: 'desc' }],
    }),
  ]);

  return {
    drafts: drafts.map(toDraftCard),
    inProgress: (inProgressRows as ApplicationRow[]).map(toApplicationCard),
    closed: (closedRows as ApplicationRow[]).map(toApplicationCard),
  };
}

function toDraftCard(d: {
  id: number;
  jobPostingId: number;
  lastSavedAt: Date;
  jobPosting: { id: number; title: string; status: string };
}): MyDraftCard {
  return {
    draftId: d.id,
    jobPostingId: d.jobPostingId,
    jobTitle: d.jobPosting.title,
    jobStatus: d.jobPosting.status,
    lastSavedAt: d.lastSavedAt.toISOString(),
  };
}

function toApplicationCard(a: ApplicationRow): MyApplicationCard {
  // 상태 변경일: visible 이력 최신 row.changedAt > submittedAt 폴백
  const lastVisibleChange = a.statusHistories[0]?.changedAt;
  return {
    applicationId: a.id,
    applicationNumber: a.applicationNumber,
    jobPostingId: a.jobPostingId,
    jobTitle: a.jobPosting.title,
    currentStage: a.currentStage,
    currentStageLabel: stageLabel(a.currentStage),
    result: a.result,
    submittedAt: a.submittedAt.toISOString(),
    withdrawnAt: a.withdrawnAt?.toISOString() ?? null,
    lastStatusChangedAt: (lastVisibleChange ?? a.submittedAt).toISOString(),
  };
}
