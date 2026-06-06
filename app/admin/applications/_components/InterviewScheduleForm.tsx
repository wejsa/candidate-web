'use client';

// CANDID-053 Step 12 — 면접 일정 등록/변경 폼(Client).
//   POST /api/admin/v1/applications/{id}/interviews { stage, scheduledAt(ISO), locationOrUrl }.
//   stage는 면접 단계(INTERVIEW_1/INTERVIEW_2)만. icsUid 멱등 — 같은 단계 재등록은 갱신(서버 처리).
//   scheduledAt datetime-local은 UTC로 해석(공고 폼과 동일 규칙, 타임존 모호성 제거).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StageType } from '@prisma/client';
import { INTERVIEW_STAGES } from '@/lib/admin/interview-stages';
import { stageLabel } from '@/lib/my-page/stage-labels';
import styles from '../applications.module.css';

interface SubmitState {
  status: 'idle' | 'pending' | 'error';
  message: string | null;
}

function messageForCode(httpStatus: number, code: unknown): string {
  if (code === 'AUTH_FORBIDDEN') return '권한이 없습니다.';
  if (code === 'APP_INVALID_STAGE_TRANSITION') return '철회된 지원서에는 면접을 등록할 수 없습니다.';
  if (code === 'APP_NOT_FOUND') return '지원서를 찾을 수 없습니다.';
  if (httpStatus === 400) return '입력값을 다시 확인해 주세요.';
  return '잠시 후 다시 시도해 주세요.';
}

export function InterviewScheduleForm({
  applicationId,
}: {
  applicationId: number;
}): React.JSX.Element {
  const router = useRouter();
  const [stage, setStage] = useState<StageType>(StageType.INTERVIEW_1);
  const [scheduledAt, setScheduledAt] = useState('');
  const [locationOrUrl, setLocationOrUrl] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle', message: null });

  async function submit(): Promise<void> {
    if (scheduledAt === '' || locationOrUrl.trim() === '') {
      setState({ status: 'error', message: '일시와 장소/링크를 입력해 주세요.' });
      return;
    }
    setState({ status: 'pending', message: null });
    let res: Response;
    try {
      res = await fetch(`/api/admin/v1/applications/${applicationId}/interviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stage,
          scheduledAt: new Date(`${scheduledAt}:00Z`).toISOString(), // datetime-local → UTC ISO
          locationOrUrl: locationOrUrl.trim(),
        }),
      });
    } catch {
      setState({ status: 'error', message: '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    if (res.ok) {
      setState({ status: 'idle', message: null });
      setLocationOrUrl('');
      router.refresh(); // 후보자 마이페이지에도 반영됨
      return;
    }
    let code: unknown;
    try {
      code = ((await res.json()) as { code?: unknown }).code;
    } catch {
      /* 본문 없음 */
    }
    setState({ status: 'error', message: messageForCode(res.status, code) });
  }

  const isPending = state.status === 'pending';

  return (
    <form
      className={styles.interviewForm}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className={styles.field}>
        면접 단계
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as StageType)}
          disabled={isPending}
        >
          {INTERVIEW_STAGES.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        일시 <span className={styles.hint}>(UTC)</span>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          required
          disabled={isPending}
        />
      </label>
      <label className={styles.field}>
        장소/화상 링크
        <input
          type="text"
          value={locationOrUrl}
          onChange={(e) => setLocationOrUrl(e.target.value)}
          maxLength={500}
          required
          disabled={isPending}
        />
      </label>
      {state.status === 'error' && state.message !== null && (
        <p role="alert" className={styles.error}>
          {state.message}
        </p>
      )}
      <button type="submit" className={styles.primaryBtn} disabled={isPending}>
        {isPending ? '저장 중…' : '면접 일정 저장'}
      </button>
    </form>
  );
}
