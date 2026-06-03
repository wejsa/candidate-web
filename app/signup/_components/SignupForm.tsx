'use client';

// CANDID-050 Step 2 — 회원가입 폼 (Client, US-AUTH-001).
// 필드는 서버 SignupInputSchema와 동일(SSOT): email/password/passwordConfirm/name +
// 약관·개인정보·만14세 동의(필수), 마케팅 동의(선택). 생년월일/연락처는 가입 시 미수집(BR-PII-05 옵션 C).
// POST /api/v1/auth/signup → 201 시 이메일 인증 안내 화면(가입과 동시에 쿠키 발급되어 로그인 상태).

import { useState } from 'react';
import styles from '@/app/_components/auth.module.css';

interface Props {
  redirectTo: string;
}

interface FormState {
  status: 'idle' | 'pending' | 'error' | 'done';
  message: string | null;
  email: string | null; // done 화면 안내용
}

// 가입 완료 안내의 이메일 부분 마스킹(공용 PC/화면 공유 노출 최소화). a***@domain 형식.
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return email;
  return `${email[0]}${'*'.repeat(at - 1)}${email.slice(at)}`;
}

function messageForSignup(httpStatus: number, code: unknown): string {
  if (code === 'USER_EMAIL_DUPLICATED') return '이미 가입된 이메일입니다. 로그인해 주세요.';
  if (httpStatus === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (httpStatus === 400) return '입력값을 다시 확인해 주세요. (비밀번호 10자 이상, 영문/숫자/기호 중 3종 조합)';
  return '잠시 후 다시 시도해 주세요.';
}

export function SignupForm({ redirectTo }: Props): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [name, setName] = useState('');
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [marketingAgreed, setMarketingAgreed] = useState(false);
  const [state, setState] = useState<FormState>({ status: 'idle', message: null, email: null });

  async function submit(): Promise<void> {
    setState({ status: 'pending', message: null, email: null });
    let res: Response;
    try {
      res = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          passwordConfirm,
          name: name.trim(),
          termsAgreed,
          privacyAgreed,
          ageConfirmed,
          marketingAgreed,
        }),
      });
    } catch {
      setState({ status: 'error', message: '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.', email: null });
      return;
    }
    if (res.status === 201) {
      setState({ status: 'done', message: null, email: email.trim() });
      return;
    }
    let code: unknown;
    try {
      code = ((await res.json()) as { code?: unknown }).code;
    } catch {
      /* 본문 없음 */
    }
    setState({ status: 'error', message: messageForSignup(res.status, code), email: null });
  }

  if (state.status === 'done') {
    return (
      <section className={styles.card} aria-labelledby="signup-done-title">
        <h2 id="signup-done-title" className={styles.cardTitle}>
          가입이 완료되었습니다
        </h2>
        <p role="status" aria-live="polite">
          {state.email !== null ? `${maskEmail(state.email)} 주소로 ` : ''}인증 메일을 보냈습니다. 메일의 링크를
          눌러 이메일 인증을 완료해 주세요. (인증 전에도 공고 조회는 가능하며, 지원서 제출 시 인증이
          필요합니다.)
        </p>
        <p className={styles.altLinks}>
          <a className={styles.primary} href={redirectTo}>
            계속하기
          </a>
        </p>
      </section>
    );
  }

  const isPending = state.status === 'pending';

  return (
    <section className={styles.card} aria-labelledby="signup-title">
      <h2 id="signup-title" className={styles.cardTitle}>
        이메일로 가입
      </h2>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim() === '' || password === '' || name.trim() === '') {
            setState({ status: 'error', message: '이메일·비밀번호·이름을 모두 입력해 주세요.', email: null });
            return;
          }
          if (password !== passwordConfirm) {
            setState({ status: 'error', message: '비밀번호와 비밀번호 확인이 일치하지 않습니다.', email: null });
            return;
          }
          if (!termsAgreed || !privacyAgreed || !ageConfirmed) {
            setState({
              status: 'error',
              message: '이용약관·개인정보 처리방침 동의와 만 14세 이상 확인이 필요합니다.',
              email: null,
            });
            return;
          }
          void submit();
        }}
      >
        <label>
          이메일
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required disabled={isPending} aria-invalid={state.status === 'error' || undefined} />
        </label>
        <label>
          이름
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required disabled={isPending} aria-invalid={state.status === 'error' || undefined} />
        </label>
        <label>
          비밀번호
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required disabled={isPending} aria-invalid={state.status === 'error' || undefined} />
        </label>
        <label>
          비밀번호 확인
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            autoComplete="new-password"
            required
            disabled={isPending}
            aria-invalid={state.status === 'error' || undefined}
            aria-describedby={state.status === 'error' ? 'signup-error' : undefined}
          />
        </label>

        <label className={styles.check}>
          <input type="checkbox" checked={termsAgreed} onChange={(e) => setTermsAgreed(e.target.checked)} disabled={isPending} />
          (필수) 서비스 이용약관에 동의합니다
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={privacyAgreed} onChange={(e) => setPrivacyAgreed(e.target.checked)} disabled={isPending} />
          (필수) 개인정보 처리방침에 동의합니다
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} disabled={isPending} />
          (필수) 만 14세 이상입니다
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={marketingAgreed} onChange={(e) => setMarketingAgreed(e.target.checked)} disabled={isPending} />
          (선택) 마케팅 정보 수신에 동의합니다
        </label>

        {state.status === 'error' && state.message !== null && (
          <p id="signup-error" role="alert" className={styles.error}>
            {state.message}
          </p>
        )}
        <button type="submit" className={styles.primary} disabled={isPending}>
          {isPending ? '가입 중…' : '가입하기'}
        </button>
      </form>

      <p className={styles.altLinks}>
        이미 계정이 있으신가요?{' '}
        <a href={`/login?redirect=${encodeURIComponent(redirectTo)}`}>로그인</a>
      </p>
    </section>
  );
}
