'use client';

// CANDID-023 Step 4 — 지원 철회 버튼 + 확인 모달 (US-MY-003).
//
// 흐름: "지원 철회" → 확인 모달(사유 선택 입력) → POST /api/v1/applications/me/{id}/withdraw
//   → 성공/409 시 router.refresh()로 RSC 재요청(result=WITHDRAWN 반영, 버튼 사라짐).
// A11y(WCAG 2.1 AA): role="dialog" + aria-modal + aria-labelledby, textarea label, 에러 role="alert".
// 보안: 네트워크 예외를 try/catch로 흡수해 pending 영구 고착 방지(account WithdrawForm H001 패턴).

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  applicationId: number;
}

interface SubmitState {
  status: 'idle' | 'pending' | 'error';
  error: string | null;
}

export function WithdrawButton({ applicationId }: Props): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle', error: null });

  async function handleConfirm(): Promise<void> {
    setState({ status: 'pending', error: null });

    let response: Response;
    try {
      response = await fetch(`/api/v1/applications/me/${applicationId}/withdraw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim() === '' ? undefined : reason.trim(),
        }),
      });
    } catch {
      setState({ status: 'error', error: '철회 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' });
      return;
    }

    // 성공(200) 또는 이미 철회/대상 아님(409) → 최신 상태로 새로고침.
    if (response.ok || response.status === 409) {
      setOpen(false);
      setState({ status: 'idle', error: null });
      router.refresh();
      return;
    }

    setState({ status: 'error', error: '철회할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        지원 철회
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="withdraw-dialog-title">
          <h3 id="withdraw-dialog-title">지원을 철회하시겠습니까?</h3>
          <p>철회 후에는 되돌릴 수 없습니다. 모집 기간 내라면 다시 지원할 수 있습니다.</p>

          <label htmlFor="withdraw-reason">철회 사유 (선택)</label>
          <textarea
            id="withdraw-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />

          {state.status === 'error' && <p role="alert">{state.error}</p>}

          <button type="button" onClick={handleConfirm} disabled={state.status === 'pending'}>
            {state.status === 'pending' ? '처리 중…' : '철회 확인'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={state.status === 'pending'}
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
}
