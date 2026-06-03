'use client';

// CANDID-022 Step 4 — 탈퇴 폼 Client Component.
//
// 비밀번호 보유 사용자: 비밀번호 + 사유(선택) 입력 → ConfirmModal 호출
// 소셜 전용 사용자: USER_REAUTH_REQUIRED 안내 메시지로 폼 비활성 (MVP 정책)
//
// 보안: 비밀번호는 React state로만 보관 (DevTools Network는 HTTPS payload, 클라이언트 console.log 없음).
// 응답 분기: 204 → /me 리디렉트, 401/422 → 인라인 에러, 409 → 안내 후 /me, 429 → 토스트 (현재는 inline).

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { WITHDRAW_LABELS } from '@/lib/users/labels';
import { ConfirmModal } from '@/app/me/withdraw/_components/ConfirmModal';

interface Props {
  isSocialOnly: boolean;
}

interface SubmitState {
  status: 'idle' | 'pending' | 'error';
  error: string | null;
}

export function WithdrawForm({ isSocialOnly }: Props): React.JSX.Element {
  const router = useRouter();
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [state, setState] = useState<SubmitState>({ status: 'idle', error: null });

  if (isSocialOnly) {
    return (
      <section aria-labelledby="withdraw-social-title" role="region">
        <h2 id="withdraw-social-title">{WITHDRAW_LABELS.formHeading}</h2>
        <p role="alert">{WITHDRAW_LABELS.socialOnlyNotice}</p>
      </section>
    );
  }

  async function handleConfirm(): Promise<void> {
    setState({ status: 'pending', error: null });
    setModalOpen(false);

    // H001 fix (review): 네트워크 예외 시 state.status='pending' 영구 고착 방지. try/catch 흡수.
    let response: Response;
    try {
      response = await fetch('/api/v1/users/me/withdraw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passwordConfirmation,
          reason: reason.trim() === '' ? undefined : reason.trim(),
        }),
      });
    } catch {
      setState({ status: 'error', error: WITHDRAW_LABELS.errorGeneric });
      return;
    }

    if (response.status === 204) {
      // 탈퇴 성공 — 쿠키는 Set-Cookie Max-Age=0으로 만료됨. /로 redirect.
      router.replace('/');
      return;
    }

    // H002 fix (review): 409 이미 탈퇴됨 → 인라인 에러가 아닌 /me redirect (page.tsx 멱등 처리와 일관).
    if (response.status === 409) {
      router.replace('/me');
      return;
    }

    let message: string = WITHDRAW_LABELS.errorGeneric;
    if (response.status === 401) message = WITHDRAW_LABELS.errorPasswordMismatch;
    else if (response.status === 422) message = WITHDRAW_LABELS.errorPasswordRequired;
    else if (response.status === 429) message = WITHDRAW_LABELS.errorRateLimited;
    setState({ status: 'error', error: message });
  }

  return (
    <section aria-labelledby="withdraw-form-title">
      <h2 id="withdraw-form-title">{WITHDRAW_LABELS.formHeading}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (passwordConfirmation.length === 0) {
            setState({ status: 'error', error: WITHDRAW_LABELS.errorPasswordRequired });
            return;
          }
          setState({ status: 'idle', error: null });
          setModalOpen(true);
        }}
      >
        <label>
          {WITHDRAW_LABELS.passwordFieldLabel}
          <input
            type="password"
            value={passwordConfirmation}
            onChange={(e) => setPasswordConfirmation(e.target.value)}
            placeholder={WITHDRAW_LABELS.passwordFieldPlaceholder}
            autoComplete="current-password"
            aria-invalid={state.status === 'error'}
            aria-describedby={state.status === 'error' ? 'withdraw-form-error' : undefined}
            required
            disabled={state.status === 'pending'}
          />
        </label>
        <label>
          {WITHDRAW_LABELS.reasonFieldLabel}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={WITHDRAW_LABELS.reasonFieldPlaceholder}
            maxLength={500}
            disabled={state.status === 'pending'}
          />
        </label>
        {state.error !== null && (
          <p id="withdraw-form-error" role="alert" aria-live="polite">
            {state.error}
          </p>
        )}
        <div>
          <button type="submit" disabled={state.status === 'pending'}>
            {WITHDRAW_LABELS.submitButton}
          </button>
          <button type="button" onClick={() => router.push('/me')}>
            {WITHDRAW_LABELS.cancelButton}
          </button>
        </div>
      </form>

      {modalOpen && (
        <ConfirmModal
          onConfirm={handleConfirm}
          onCancel={() => setModalOpen(false)}
        />
      )}
    </section>
  );
}
