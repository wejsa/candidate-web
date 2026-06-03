'use client';

// CANDID-050 Step 2 — 로그인 폼 (Client, US-AUTH-002).
// POST /api/v1/auth/login → 200 시 redirectTo로 이동(서버에서 sanitize된 안전 경로).
// 에러 코드 매핑(SSOT는 서버 ERROR_CATALOG): 401 자격 불일치 / 423·429 잠금 / 429 과다요청 / 400 검증.
// 비밀번호는 상태에만 보관하고 로깅/URL 노출 없음.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/app/_components/auth.module.css';

interface Props {
  redirectTo: string;
}

interface SubmitState {
  status: 'idle' | 'pending' | 'error';
  message: string | null;
}

// 서버 응답 code → 사용자 메시지. 미매핑 코드는 generic.
function messageForLogin(httpStatus: number, code: unknown): string {
  if (code === 'AUTH_INVALID_CREDENTIALS') return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (code === 'AUTH_ACCOUNT_LOCKED')
    return '로그인 시도가 5회를 초과해 계정이 일시 잠겼습니다. 15분 후 다시 시도해 주세요.';
  if (code === 'AUTH_EMAIL_NOT_VERIFIED') return '이메일 인증이 필요합니다. 받은 편지함을 확인해 주세요.';
  if (httpStatus === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (httpStatus === 400) return '입력값을 다시 확인해 주세요.';
  return '잠시 후 다시 시도해 주세요.';
}

const OAUTH_PROVIDERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'google', label: 'Google로 계속하기' },
  { id: 'github', label: 'GitHub로 계속하기' },
];

export function LoginForm({ redirectTo }: Props): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle', message: null });

  async function submit(): Promise<void> {
    setState({ status: 'pending', message: null });
    let res: Response;
    try {
      res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
    } catch {
      setState({ status: 'error', message: '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    if (res.status === 200) {
      // 헤더(서버 컴포넌트)의 인증 상태 갱신을 위해 refresh 후 목적지 이동.
      router.replace(redirectTo);
      router.refresh();
      return;
    }
    let code: unknown;
    try {
      code = ((await res.json()) as { code?: unknown }).code;
    } catch {
      /* 본문 없음 — httpStatus로만 분기 */
    }
    setState({ status: 'error', message: messageForLogin(res.status, code) });
  }

  const isPending = state.status === 'pending';

  return (
    <section className={styles.card} aria-labelledby="login-title">
      <h2 id="login-title" className={styles.cardTitle}>
        이메일로 로그인
      </h2>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim() === '' || password === '') {
            setState({ status: 'error', message: '이메일과 비밀번호를 모두 입력해 주세요.' });
            return;
          }
          void submit();
        }}
      >
        <label>
          이메일
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            disabled={isPending}
            aria-invalid={state.status === 'error'}
          />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={isPending}
            aria-invalid={state.status === 'error'}
            aria-describedby={state.status === 'error' ? 'login-error' : undefined}
          />
        </label>
        {state.status === 'error' && state.message !== null && (
          <p id="login-error" role="alert" className={styles.error}>
            {state.message}
          </p>
        )}
        <button type="submit" className={styles.primary} disabled={isPending}>
          {isPending ? '로그인 중…' : '로그인'}
        </button>
      </form>

      <div className={styles.social}>
        {OAUTH_PROVIDERS.map((p) => (
          <a
            key={p.id}
            className={styles.socialLink}
            href={`/api/v1/auth/oauth/${p.id}?redirect=${encodeURIComponent(redirectTo)}`}
          >
            {p.label}
          </a>
        ))}
      </div>

      <p className={styles.altLinks}>
        <a href="/password/reset-request">비밀번호를 잊으셨나요?</a>
        <span aria-hidden="true"> · </span>
        <a href={`/signup?redirect=${encodeURIComponent(redirectTo)}`}>회원가입</a>
      </p>
    </section>
  );
}
