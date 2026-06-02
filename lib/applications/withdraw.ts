// CANDID-023 Step 2 — 지원 철회 (US-MY-003).
//
// 단일 트랜잭션 (BR-TX-01):
//   1) 조건부 UPDATE: WHERE id=app AND user_id AND result=IN_PROGRESS
//      → result=WITHDRAWN, withdrawn_at=now, withdraw_reason=reason
//      affected=0 → APP_NOT_WITHDRAWABLE (미존재 / 비소유 / 이미 종결 — 정보 누출 회피 단일 코드)
//      이 `result=IN_PROGRESS` 가드가 멱등성 + 동시 철회 경합 방어를 동시에 제공한다.
//      (낙관적 락 version 컬럼 불필요 — db-designer CANDID-023 분석. PASSED/FAILED/WITHDRAWN 덮어쓰기 차단)
//   2) AuditLog(APPLICATION_WITHDRAW) — actor=본인, resource=application.
//      metadataJson은 PII-free (사유 평문 미포함 — BR-PII-02). 사유 본문은 withdraw_reason 컬럼에만 저장.
//
// 트랜잭션 외 (BR-TX-02): 어드민 Slack 알림은 Step 4에서 호출자(API)가 트랜잭션 커밋 후
//   fire-and-forget으로 발행한다. 본 서비스는 DB 상태 전이만 담당(롤백 위험 분리).
//
// 사유(reason)는 호출자(API zod)에서 sanitize 후 전달된다 — 본 서비스는 저장만 수행
//   (L-006 이중 방어: 저장측 sanitize는 API 경계, 출력측 sanitize는 UI 렌더).

import 'server-only';
import { ApplicationResult, AuditEventType, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { WithdrawnApplicationSummary } from '@/lib/applications/types';

interface WithdrawInput {
  userId: number;
  applicationId: number;
  /** 철회 사유 — 선택 입력. 호출자(API)에서 sanitize + 길이 검증 후 전달. */
  reason?: string | null;
  now?: Date;
}

/**
 * 진행 중(IN_PROGRESS) 지원을 본인이 철회한다.
 *
 * - 조건부 UPDATE 1회로 소유권 + 상태 가드 + 멱등성을 원자적으로 처리.
 * - 종결 상태(PASSED/FAILED/이미 WITHDRAWN)이거나 타인/미존재 지원은 모두 단일
 *   `APP_NOT_WITHDRAWABLE`(409)로 응답 — 존재 여부를 노출하지 않는다.
 *
 * @returns PII-free 응답 (result=WITHDRAWN + withdrawnAt)
 */
export async function withdrawApplication({
  userId,
  applicationId,
  reason = null,
  now = new Date(),
}: WithdrawInput): Promise<WithdrawnApplicationSummary> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.application.updateMany({
      where: {
        id: applicationId,
        userId,
        result: ApplicationResult.IN_PROGRESS,
      },
      data: {
        result: ApplicationResult.WITHDRAWN,
        withdrawnAt: now,
        withdrawReason: reason,
      },
    });

    // affected=0 → 미존재 / 비소유 / 이미 종결. 단일 코드(정보 누출 회피).
    if (count === 0) {
      throw new AppError('APP_NOT_WITHDRAWABLE');
    }

    // 감사 로그 — 사유 평문은 metadata에 넣지 않는다(BR-PII-02). 존재 여부만 기록.
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        eventType: AuditEventType.APPLICATION_WITHDRAW,
        resourceType: 'application',
        resourceId: String(applicationId),
        metadataJson: { hasReason: reason !== null && reason !== '' } as Prisma.InputJsonValue,
      },
    });
  });

  return {
    result: 'WITHDRAWN',
    withdrawnAt: now.toISOString(),
  };
}
