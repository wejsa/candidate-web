'use client';

// CANDID-022 Step 4 — 최종 확인 모달 Client Component.
//
// 접근성: role="dialog" + aria-modal=true + aria-labelledby + focus-trap(ESC/Tab 순환/포커스 복원).
// CANDID-028 Step 2 — useFocusTrap 도입(ESC·Tab trap·복원·스크롤락 일원화). 확인 버튼은
//   비가역(회원 탈퇴) destructive 액션이므로 .btn-danger로 시각 구분(취소는 .btn-secondary).

import { useFocusTrap } from '@/lib/ui/use-focus-trap';
import { WITHDRAW_LABELS } from '@/lib/users/labels';

interface Props {
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmModal({ onConfirm, onCancel }: Props): React.JSX.Element {
  const ref = useFocusTrap<HTMLDivElement>(true, onCancel);

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="withdraw-confirm-title">
      <h2 id="withdraw-confirm-title">{WITHDRAW_LABELS.modalHeading}</h2>
      <p>{WITHDRAW_LABELS.noticeIrreversible}</p>
      <p>{WITHDRAW_LABELS.noticeRefreshTokenRevoke}</p>
      <div>
        <button type="button" className="btn-danger" onClick={() => void onConfirm()} autoFocus>
          {WITHDRAW_LABELS.modalConfirmButton}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {WITHDRAW_LABELS.modalCancelButton}
        </button>
      </div>
    </div>
  );
}
