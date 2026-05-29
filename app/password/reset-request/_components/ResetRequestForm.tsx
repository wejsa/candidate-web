'use client';

// CANDID-020 Step 3 — 비밀번호 재설정 요청 폼 Client Component (US-AUTH-004).
//
// 이메일 입력 → POST /api/v1/auth/password/reset-request → 성공 시 균일 안내 메시지 표시.
// 계정 열거 방지: 서버가 계정 존재 여부와 무관하게 항상 200 + 동일 메시지를 반환하므로,
// UI도 성공 분기에서 서버 message를 그대로 노출한다(존재/미존재 구분 없음).
// 형식 오류(400)·과도 요청(429)만 사용자 입력 결함으로 인라인 에러 처리.

import { useState } from 'react';

const LABELS = {
  heading: '비밀번호 재설정',
  description: '가입한 이메일 주소를 입력하시면 재설정 안내 메일을 보내드립니다.',
  emailLabel: '이메일',
  emailPlaceholder: 'you@example.com',
  submit: '재설정 메일 받기',
  submitting: '보내는 중…',
  backToLogin: '로그인으로 돌아가기',
  errorEmailRequired: '이메일 주소를 입력해 주세요.',
  errorEmailInvalid: '이메일 주소 형식을 다시 확인해 주세요.',
  errorRateLimited: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  errorGeneric: '잠시 후 다시 시도해 주세요.',
} as const;

interface SubmitState {
  status: 'idle' | 'pending' | 'done' | 'error';
  /** 성공 시 서버의 균일 안내 메시지 / 에러 시 사용자 안내. */
  message: string | null;
}

export function ResetRequestForm(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle', message: null });

  async function submit(): Promise<void> {
    setState({ status: 'pending', message: null });

    let response: Response;
    try {
      response = await fetch('/api/v1/auth/password/reset-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      setState({ status: 'error', message: LABELS.errorGeneric });
      return;
    }

    if (response.status === 200) {
      // 균일 응답 — 계정 존재 여부와 무관. 서버 message를 그대로 표시(없으면 기본 안내).
      let serverMessage: string | null = null;
      try {
        const body = (await response.json()) as { message?: unknown };
        if (typeof body.message === 'string') serverMessage = body.message;
      } catch {
        // 본문 파싱 실패는 무시 — 성공 분기 안내는 유지.
      }
      setState({ status: 'done', message: serverMessage });
      return;
    }

    let message: string = LABELS.errorGeneric;
    if (response.status === 400) message = LABELS.errorEmailInvalid;
    else if (response.status === 429) message = LABELS.errorRateLimited;
    setState({ status: 'error', message });
  }

  if (state.status === 'done') {
    return (
      <section aria-labelledby="reset-request-done-title">
        <h2 id="reset-request-done-title">{LABELS.heading}</h2>
        <p role="status" aria-live="polite">
          {state.message ??
            '입력하신 이메일이 가입되어 있다면 재설정 안내 메일을 보냈습니다.'}
        </p>
        <p>
          <a href="/login">{LABELS.backToLogin}</a>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="reset-request-form-title">
      <h2 id="reset-request-form-title">{LABELS.heading}</h2>
      <p>{LABELS.description}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim().length === 0) {
            setState({ status: 'error', message: LABELS.errorEmailRequired });
            return;
          }
          void submit();
        }}
      >
        <label>
          {LABELS.emailLabel}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={LABELS.emailPlaceholder}
            autoComplete="email"
            required
            disabled={state.status === 'pending'}
            aria-invalid={state.status === 'error'}
            aria-describedby={state.status === 'error' ? 'reset-request-error' : undefined}
          />
        </label>
        {state.status === 'error' && state.message !== null && (
          <p id="reset-request-error" role="alert" aria-live="polite">
            {state.message}
          </p>
        )}
        <div>
          <button type="submit" disabled={state.status === 'pending'}>
            {state.status === 'pending' ? LABELS.submitting : LABELS.submit}
          </button>
          <a href="/login">{LABELS.backToLogin}</a>
        </div>
      </form>
    </section>
  );
}
