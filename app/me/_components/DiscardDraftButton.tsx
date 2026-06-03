// CANDID — 작성 중 지원서(Draft) 폐기 버튼 (마이페이지).
//
// DELETE /api/v1/drafts/{jobPostingId} → 성공 시 router.refresh()로 목록 갱신.
// 파괴적 동작이므로 인라인 2단계 확인(취소 → "삭제할까요? [삭제][아니오]").
// stretched-link 카드 내부의 인터랙티브 요소이므로 z-index 부여(부모 카드 클릭 가로채기 방지).

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/app/me/me.module.css';

interface Props {
  jobPostingId: number;
}

export function DiscardDraftButton({ jobPostingId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function discard(): Promise<void> {
    setPending(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/v1/drafts/${jobPostingId}`, { method: 'DELETE' });
    } catch {
      setPending(false);
      setError('네트워크 오류로 취소하지 못했습니다.');
      return;
    }
    if (res.status === 204) {
      router.refresh();
      return; // 갱신으로 카드 사라짐 — pending 유지(언마운트)
    }
    setPending(false);
    setError(
      res.status === 401
        ? '세션이 만료되었습니다. 다시 로그인해 주세요.'
        : '작성 취소에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className={styles.draftDiscard}
        onClick={() => setConfirming(true)}
      >
        작성 취소
      </button>
    );
  }

  return (
    <span className={styles.discardConfirm} role="group" aria-label="작성 취소 확인">
      <span className={styles.discardPrompt}>작성 중인 내용을 삭제할까요?</span>
      <button
        type="button"
        className={styles.draftDiscard}
        onClick={() => void discard()}
        disabled={pending}
      >
        {pending ? '삭제 중…' : '삭제'}
      </button>
      <button
        type="button"
        className={styles.discardCancel}
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        아니오
      </button>
      {error !== null && (
        <span className={styles.errorNote} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
