'use client';

// CANDID-053 Step 9 — 공고 상태 전이 컨트롤(Client). 목록 행에서 허용 전이만 버튼 노출.
//   PATCH /api/admin/v1/job-postings/{id} { status } → 서버가 전이 그래프를 최종 강제(클라 노출은 UX 힌트).
//   전이 그래프: DRAFT↔OPEN→CLOSED, CLOSED는 종단(버튼 없음).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { JobStatus } from '@prisma/client';
import styles from '../job-postings.module.css';

// 서버 ALLOWED_STATUS_TRANSITIONS(lib/admin/job-postings.ts)와 동일 — UX 힌트용 미러.
const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  DRAFT: [JobStatus.OPEN, JobStatus.CLOSED],
  OPEN: [JobStatus.DRAFT, JobStatus.CLOSED],
  CLOSED: [],
};

const ACTION_LABEL: Record<JobStatus, string> = {
  OPEN: '공개',
  DRAFT: '비공개로',
  CLOSED: '마감',
};

export function StatusControl({
  jobPostingId,
  current,
}: {
  jobPostingId: number;
  current: JobStatus;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transition(to: JobStatus): Promise<void> {
    setPending(to);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/admin/v1/job-postings/${jobPostingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: to }),
      });
    } catch {
      setPending(null);
      setError('네트워크 오류');
      return;
    }
    setPending(null);
    if (res.ok) {
      router.refresh();
      return;
    }
    setError(res.status === 403 ? '권한 없음' : '전이 실패');
  }

  const targets = ALLOWED[current];
  if (targets.length === 0) {
    return <span className={styles.terminal}>—</span>;
  }

  return (
    <span className={styles.statusActions}>
      {targets.map((to) => (
        <button
          key={to}
          type="button"
          className={styles.statusBtn}
          disabled={pending !== null}
          onClick={() => void transition(to)}
        >
          {pending === to ? '…' : ACTION_LABEL[to]}
        </button>
      ))}
      {error !== null && (
        <span role="alert" className={styles.inlineError}>
          {error}
        </span>
      )}
    </span>
  );
}
