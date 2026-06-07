'use client';

// 이메일 인증 상태 + 인증 메일 재발송 Client Component (US-AUTH-001 / BR-AUTH-04).
//
// 인증 상태(emailVerified)를 칩으로 표시하고, 미인증이면 재발송 버튼을 노출한다.
// POST /api/v1/auth/resend-verification — 인증 쿠키 기반(바디 없음), 다층 rate limit(429).
// 미인증 사용자는 지원서 "제출" 시점에만 차단되므로(BR-AUTH-04) 여기서 인증을 유도한다.

import { useState } from 'react';
import styles from '@/app/me/profile/profile.module.css';

interface EmailVerificationSectionProps {
  emailVerified: boolean;
  email: string;
}

export function EmailVerificationSection({ emailVerified, email }: EmailVerificationSectionProps) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'status'; text: string } | null>(null);

  async function resend(): Promise<void> {
    setPending(true);
    setMessage(null);
    let res: Response;
    try {
      res = await fetch('/api/v1/auth/resend-verification', { method: 'POST' });
    } catch {
      setPending(false);
      setMessage({ kind: 'error', text: '네트워크 오류로 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    setPending(false);

    if (res.ok) {
      setSent(true);
      setMessage({ kind: 'status', text: '인증 메일을 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.' });
      return;
    }
    if (res.status === 429) {
      setMessage({ kind: 'error', text: '재발송 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    // AUTH_EMAIL_ALREADY_VERIFIED(이미 인증) 등 표준 에러 코드 분기.
    let code = '';
    try {
      code = ((await res.json()) as { code?: string }).code ?? '';
    } catch {
      // 본문 파싱 실패는 무시 — 아래 일반 메시지로 폴백.
    }
    if (code === 'AUTH_EMAIL_ALREADY_VERIFIED') {
      setMessage({ kind: 'status', text: '이미 인증된 이메일입니다. 페이지를 새로고침해 주세요.' });
      return;
    }
    setMessage({ kind: 'error', text: '인증 메일 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }

  return (
    <section className={styles.card} aria-labelledby="email-verify-title">
      <h2 id="email-verify-title" className={styles.cardTitle}>
        이메일 인증
      </h2>
      <p className={styles.statusRow}>
        <span
          className={`${styles.statusChip} ${emailVerified ? styles.statusLinked : styles.statusWarn}`}
        >
          {emailVerified ? '인증됨' : '미인증'}
        </span>
        {email}
      </p>
      {!emailVerified && (
        <>
          <p className={styles.hint}>
            이메일 인증을 완료해야 지원서를 제출할 수 있습니다. 받은 인증 메일의 링크를 클릭하거나,
            메일이 없으면 아래 버튼으로 다시 받아보세요.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || sent}
            onClick={() => void resend()}
          >
            {pending ? '전송 중…' : sent ? '전송됨' : '인증 메일 재발송'}
          </button>
        </>
      )}
      {message !== null && (
        <p
          className={`${styles.msg} ${message.kind === 'error' ? styles.msgError : styles.msgOk}`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
