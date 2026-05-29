'use client';

// CANDID-020 Step 5 — 비밀번호 재설정 확정 폼 Client Component (US-AUTH-004).
//
// 쿼리스트링 토큰 + 새 비밀번호/확인 → POST /api/v1/auth/password/reset.
// - 토큰 부재/무효/만료(AUTH_RESET_TOKEN_INVALID/EXPIRED) → 재요청 안내 + 링크.
// - 비밀번호 강도/일치는 클라이언트 사전 검증(UX) + 서버 권위(Step 4 zod).
// - 성공 시 모든 세션이 무효화되므로 로그인 페이지로 유도.

import { useState } from 'react';

const LABELS = {
  heading: '새 비밀번호 설정',
  passwordLabel: '새 비밀번호',
  passwordConfirmLabel: '새 비밀번호 확인',
  passwordHint: '10자 이상, 영문 대/소문자·숫자·특수문자 중 3종 이상',
  submit: '비밀번호 변경',
  submitting: '변경 중…',
  toLogin: '로그인하러 가기',
  reRequest: '재설정 메일 다시 요청하기',
  errInvalidLink: '재설정 링크가 유효하지 않거나 만료되었습니다. 재설정을 다시 요청해 주세요.',
  errMismatch: '비밀번호와 비밀번호 확인이 일치하지 않습니다.',
  errWeak: '비밀번호는 10자 이상, 영문 대/소문자·숫자·특수문자 중 3종 이상이어야 합니다.',
  errRateLimited: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  errGeneric: '잠시 후 다시 시도해 주세요.',
  successTitle: '비밀번호가 변경되었습니다',
  successBody: '보안을 위해 모든 기기에서 로그아웃되었습니다. 새 비밀번호로 다시 로그인해 주세요.',
} as const;

interface Props {
  /** 페이지가 쿼리스트링에서 추출한 토큰. 부재 시 빈 문자열. */
  token: string;
}

interface FormState {
  status: 'idle' | 'pending' | 'done' | 'error' | 'invalid-link';
  message: string | null;
}

export function ResetForm({ token }: Props): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [state, setState] = useState<FormState>(
    token === ''
      ? { status: 'invalid-link', message: LABELS.errInvalidLink }
      : { status: 'idle', message: null },
  );

  async function submit(): Promise<void> {
    setState({ status: 'pending', message: null });

    let response: Response;
    try {
      response = await fetch('/api/v1/auth/password/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password, passwordConfirm }),
      });
    } catch {
      setState({ status: 'error', message: LABELS.errGeneric });
      return;
    }

    if (response.status === 200) {
      setState({ status: 'done', message: null });
      return;
    }

    // 토큰 무효/만료는 재요청 안내 화면으로 전환. 그 외 4xx는 인라인 에러.
    let code: string | null = null;
    try {
      const body = (await response.json()) as { code?: unknown };
      if (typeof body.code === 'string') code = body.code;
    } catch {
      /* 본문 파싱 실패 무시 */
    }

    if (code === 'AUTH_RESET_TOKEN_INVALID' || code === 'AUTH_RESET_TOKEN_EXPIRED') {
      setState({ status: 'invalid-link', message: LABELS.errInvalidLink });
      return;
    }
    // 그 외 4xx/5xx → 인라인 에러. 429(과도 요청)·400(강도/형식)은 명시 안내.
    let message: string = LABELS.errGeneric;
    if (response.status === 429) message = LABELS.errRateLimited;
    else if (response.status === 400) message = LABELS.errWeak;
    setState({ status: 'error', message });
  }

  if (state.status === 'done') {
    return (
      <section aria-labelledby="reset-done-title">
        <h2 id="reset-done-title">{LABELS.successTitle}</h2>
        <p role="status" aria-live="polite">
          {LABELS.successBody}
        </p>
        <p>
          <a href="/login">{LABELS.toLogin}</a>
        </p>
      </section>
    );
  }

  if (state.status === 'invalid-link') {
    return (
      <section aria-labelledby="reset-invalid-title">
        <h2 id="reset-invalid-title">{LABELS.heading}</h2>
        <p role="alert">{state.message ?? LABELS.errInvalidLink}</p>
        <p>
          <a href="/password/reset-request">{LABELS.reRequest}</a>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="reset-form-title">
      <h2 id="reset-form-title">{LABELS.heading}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== passwordConfirm) {
            setState({ status: 'error', message: LABELS.errMismatch });
            return;
          }
          void submit();
        }}
      >
        <label>
          {LABELS.passwordLabel}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={10}
            aria-describedby="reset-password-hint"
            disabled={state.status === 'pending'}
          />
        </label>
        <p id="reset-password-hint">{LABELS.passwordHint}</p>
        <label>
          {LABELS.passwordConfirmLabel}
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            autoComplete="new-password"
            required
            disabled={state.status === 'pending'}
            aria-invalid={state.status === 'error'}
            aria-describedby={state.status === 'error' ? 'reset-error' : undefined}
          />
        </label>
        {state.status === 'error' && state.message !== null && (
          <p id="reset-error" role="alert" aria-live="polite">
            {state.message}
          </p>
        )}
        <button type="submit" disabled={state.status === 'pending'}>
          {state.status === 'pending' ? LABELS.submitting : LABELS.submit}
        </button>
      </form>
    </section>
  );
}
