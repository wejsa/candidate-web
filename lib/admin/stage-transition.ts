import 'server-only';
import { AuditEventType, ApplicationResult, StageType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { recordAuditEvent } from '@/lib/audit/record';

// CANDID-053 Step 6 — 전형 단계 전이 그래프 + 이력 write + 결과 결정 (FR-007, RBAC A안).
//
// 도메인:
//   - 허용 전이 그래프로 임의/점프 전이 차단(SUBMITTED→HIRED 등 거부).
//   - HIRED/REJECTED는 종단. 철회(result=WITHDRAWN) 지원서는 전이 불가.
//   - 상태 변경 + 이력 1건 + 감사는 단일 트랜잭션(BR-TX-01). 행 FOR UPDATE로 동시 전이 직렬화.

/** 허용 전이 그래프. 각 단계 → 진행 단계(들) + REJECTED. HIRED/REJECTED 종단. */
const ALLOWED_STAGE_TRANSITIONS: Record<StageType, readonly StageType[]> = {
  [StageType.SUBMITTED]: [StageType.DOC_REVIEW, StageType.REJECTED],
  [StageType.DOC_REVIEW]: [StageType.INTERVIEW_1, StageType.REJECTED],
  [StageType.INTERVIEW_1]: [StageType.INTERVIEW_2, StageType.OFFER, StageType.REJECTED], // 2차 생략 허용
  [StageType.INTERVIEW_2]: [StageType.OFFER, StageType.REJECTED],
  [StageType.OFFER]: [StageType.HIRED, StageType.REJECTED],
  [StageType.HIRED]: [],
  [StageType.REJECTED]: [],
};

/** 단계 → 지원 결과 파생. HIRED=합격, REJECTED=불합격, 그 외 진행 중. */
function resultForStage(stage: StageType): ApplicationResult {
  if (stage === StageType.HIRED) return ApplicationResult.PASSED;
  if (stage === StageType.REJECTED) return ApplicationResult.FAILED;
  return ApplicationResult.IN_PROGRESS;
}

export interface TransitionStageArgs {
  actorUserId: number;
  applicationId: number;
  toStage: StageType;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface StageTransitionResult {
  applicationId: number;
  fromStage: StageType;
  toStage: StageType;
  result: ApplicationResult;
}

export async function transitionApplicationStage(
  args: TransitionStageArgs,
): Promise<StageTransitionResult> {
  const { actorUserId, applicationId, toStage } = args;

  return prisma.$transaction(async (tx) => {
    // 행 잠금 + 현재 단계/결과 조회 — 동시 PATCH read-then-update race 직렬화(Step 3/4 선례 정합).
    // eslint-disable-next-line no-restricted-syntax -- FOR UPDATE 잠금 전용, PII 컬럼 미선택 (db-designer 가드)
    const rows = await tx.$queryRaw<{ current_stage: StageType; result: ApplicationResult }[]>`
      SELECT current_stage, result FROM applications WHERE id = ${applicationId} FOR UPDATE
    `;
    const existing = rows[0];
    if (existing === undefined) {
      throw new AppError('APP_NOT_FOUND');
    }

    // 철회 지원서는 전이 불가 — 종단 상태.
    if (existing.result === ApplicationResult.WITHDRAWN) {
      throw new AppError('APP_INVALID_STAGE_TRANSITION', {
        message: '철회된 지원서는 전형 단계를 변경할 수 없습니다.',
        details: [{ field: 'toStage', reason: 'application withdrawn' }],
      });
    }

    const fromStage = existing.current_stage;
    if (!ALLOWED_STAGE_TRANSITIONS[fromStage].includes(toStage)) {
      throw new AppError('APP_INVALID_STAGE_TRANSITION', {
        message: `허용되지 않는 전형 단계 전이입니다: ${fromStage} → ${toStage}`,
        details: [{ field: 'toStage', reason: `from ${fromStage} to ${toStage}` }],
      });
    }

    const result = resultForStage(toStage);

    await tx.application.update({
      where: { id: applicationId },
      data: { currentStage: toStage, result },
    });
    // 이력 1건 — 운영자(changedByUserId)가 변경. 후보자 타임라인에 노출(visibleToCandidate 기본 true).
    await tx.applicationStatusHistory.create({
      data: { applicationId, fromStage, toStage, changedByUserId: actorUserId },
    });
    await recordAuditEvent(
      {
        eventType: AuditEventType.APPLICATION_STAGE_CHANGED,
        actorUserId,
        resourceType: 'application',
        resourceId: String(applicationId),
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
        metadata: { from: fromStage, to: toStage, result }, // PII-free (enum 값만)
      },
      { tx },
    );

    return { applicationId, fromStage, toStage, result };
  });
}
