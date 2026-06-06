'use client';

// CANDID-053 Step 12 — 전형 단계 전이 컨트롤(Client). 현재 단계의 허용 전이만 버튼 노출.
//   PATCH /api/admin/v1/applications/{id}/stage { toStage } → 서버가 전이 그래프/철회 가드/이력·감사를
//   단일 트랜잭션으로 최종 강제(클라 노출은 UX 힌트). 전이 그래프는 서버와 동일 SSOT를 import(드리프트 차단).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StageType } from '@prisma/client';
import { STAGE_TRANSITIONS } from '@/lib/admin/stage-transitions-graph';
import { stageLabel } from '@/lib/my-page/stage-labels';
import styles from '../applications.module.css';

function messageForCode(httpStatus: number, code: unknown): string {
  if (code === 'AUTH_FORBIDDEN') return '권한이 없습니다.';
  if (code === 'APP_INVALID_STAGE_TRANSITION') return '허용되지 않는 전이입니다(철회/종단/그래프 위반).';
  if (code === 'APP_NOT_FOUND') return '지원서를 찾을 수 없습니다.';
  if (httpStatus === 400) return '요청을 확인해 주세요.';
  return '잠시 후 다시 시도해 주세요.';
}

export function StageTransitionControl({
  applicationId,
  currentStage,
}: {
  applicationId: number;
  currentStage: StageType;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<StageType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transition(toStage: StageType): Promise<void> {
    setPending(toStage);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/admin/v1/applications/${applicationId}/stage`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toStage }),
      });
    } catch {
      setPending(null);
      setError('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (res.ok) {
      router.refresh(); // 변경된 단계/이력 반영
      return;
    }
    setPending(null);
    let code: unknown;
    try {
      code = ((await res.json()) as { code?: unknown }).code;
    } catch {
      /* 본문 없음 */
    }
    setError(messageForCode(res.status, code));
  }

  const targets = STAGE_TRANSITIONS[currentStage];

  return (
    <div>
      {targets.length === 0 ? (
        <p className={styles.empty}>종단 단계입니다 — 추가 전이가 없습니다.</p>
      ) : (
        <div className={styles.stageBtns}>
          {targets.map((to) => (
            <button
              key={to}
              type="button"
              className={styles.stageBtn}
              disabled={pending !== null}
              onClick={() => void transition(to)}
            >
              {pending === to ? '처리 중…' : `${stageLabel(to)}(으)로`}
            </button>
          ))}
        </div>
      )}
      {error !== null && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
