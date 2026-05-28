'use client';

// CANDID-022 Step 4 — 최종 확인 모달 Client Component.
//
// 접근성: role="dialog" + aria-modal=true + aria-labelledby + ESC 키 cancel.
// 디자인 시스템 미도입 — 본 Step은 시맨틱 HTML + ARIA만 (CSS는 후속 task).

import { useEffect } from 'react';
import { WITHDRAW_LABELS } from '@/lib/users/labels';

interface Props {
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmModal({ onConfirm, onCancel }: Props): React.JSX.Element {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-confirm-title"
    >
      <h2 id="withdraw-confirm-title">{WITHDRAW_LABELS.modalHeading}</h2>
      <p>{WITHDRAW_LABELS.noticeIrreversible}</p>
      <p>{WITHDRAW_LABELS.noticeRefreshTokenRevoke}</p>
      <div>
        <button type="button" onClick={() => void onConfirm()} autoFocus>
          {WITHDRAW_LABELS.modalConfirmButton}
        </button>
        <button type="button" onClick={onCancel}>
          {WITHDRAW_LABELS.modalCancelButton}
        </button>
      </div>
    </div>
  );
}
