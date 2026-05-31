'use client';

// CANDID-024 Step 3 — 비밀번호 변경 폼 Client Component (US-MY-004, BR-AUTH-05).
//
// 현재/새/확인 비밀번호 → POST /api/v1/users/me/password → 204 성공 시 안내(전체 세션 revoke → 재로그인).
// 소셜 전용 계정(hasPassword=false)은 현재 비밀번호 입력란을 숨긴다(최초 설정).
// 분기 로직(확인 일치, 에러 분류)은 lib/users/profile-form.ts에 위임.

import { useState, type FormEvent } from 'react';
import { PASSWORD_CHANGE_LABELS as L, classifyPasswordChangeError } from '@/lib/users/profile-form';

interface PasswordChangeFormProps {
  /** 비밀번호 설정 여부 — false면 소셜 전용 최초 설정 모드(현재 비번 불요). */
  hasPassword: boolean;
}

interface FormState {
  status: 'idle' | 'pending' | 'done' | 'error';
  message: string | null;
}

export function PasswordChangeForm({ hasPassword }: PasswordChangeFormProps) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<FormState>({ status: 'idle', message: null });

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    if (next !== confirm) {
      setState({ status: 'error', message: L.errorMismatch });
      return;
    }

    setState({ status: 'pending', message: null });
    const payload: { newPassword: string; currentPassword?: string } = { newPassword: next };
    if (hasPassword) payload.currentPassword = current;

    let response: Response;
    try {
      response = await fetch('/api/v1/users/me/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setState({ status: 'error', message: L.errorGeneric });
      return;
    }

    if (response.status === 204) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setState({ status: 'done', message: L.done });
      return;
    }

    setState({ status: 'error', message: classifyPasswordChangeError(response.status) });
  }

  return (
    <form onSubmit={submit} aria-labelledby="password-change-title">
      <h2 id="password-change-title">{L.heading}</h2>

      {hasPassword && (
        <label>
          {L.currentLabel}
          <input
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
      )}

      <label>
        {L.newLabel}
        <input
          type="password"
          value={next}
          autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </label>

      <label>
        {L.confirmLabel}
        <input
          type="password"
          value={confirm}
          autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>

      {state.message !== null && (
        <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>
      )}

      <button type="submit" disabled={state.status === 'pending'}>
        {state.status === 'pending' ? L.submitting : L.submit}
      </button>
    </form>
  );
}
