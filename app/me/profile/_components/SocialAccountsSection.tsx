'use client';

// CANDID-024 Step 4 — 소셜 계정 관리(연결 목록 + 해제) Client Component (US-MY-004).
//
// 연결된 provider는 "연결 해제" 버튼(DELETE /api/v1/users/me/providers/{provider}), 미연결은 표시만.
// 연결 추가(authenticated link-add)는 Step 5(OAuth 링크 플로우)에서 제공한다.
// 에러 분류는 lib/users/profile-form.ts(classifyUnlinkError)에 위임 — 마지막 인증수단(409) 안내 포함.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SOCIAL_ACCOUNTS_LABELS as L, classifyUnlinkError } from '@/lib/users/profile-form';
import type { ProfileProvider, ProfileProviderName } from '@/lib/users/types';

const PROVIDER_LABELS: Record<ProfileProviderName, string> = {
  google: 'Google',
  github: 'GitHub',
};
const ALL_PROVIDERS: readonly ProfileProviderName[] = ['google', 'github'];

interface SocialAccountsSectionProps {
  providers: ProfileProvider[];
}

export function SocialAccountsSection({ providers }: SocialAccountsSectionProps) {
  const router = useRouter();
  const [pending, setPending] = useState<ProfileProviderName | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'status'; text: string } | null>(null);

  const linked = new Set(providers.map((p) => p.provider));

  async function unlink(provider: ProfileProviderName): Promise<void> {
    setPending(provider);
    setMessage(null);
    let res: Response;
    try {
      res = await fetch(`/api/v1/users/me/providers/${provider}`, { method: 'DELETE' });
    } catch {
      setPending(null);
      setMessage({ kind: 'error', text: L.errorGeneric });
      return;
    }
    setPending(null);
    if (res.status === 204) {
      setMessage({ kind: 'status', text: L.unlinked });
      router.refresh();
      return;
    }
    setMessage({ kind: 'error', text: classifyUnlinkError(res.status) });
  }

  return (
    <section aria-labelledby="social-accounts-title">
      <h2 id="social-accounts-title">{L.heading}</h2>
      <ul>
        {ALL_PROVIDERS.map((provider) => {
          const isLinked = linked.has(provider);
          return (
            <li key={provider}>
              <span>{PROVIDER_LABELS[provider]}</span>
              {isLinked ? (
                <button
                  type="button"
                  disabled={pending === provider}
                  onClick={() => void unlink(provider)}
                >
                  {pending === provider ? L.unlinking : L.unlink}
                </button>
              ) : (
                <span> · {L.notLinked}</span>
              )}
            </li>
          );
        })}
      </ul>
      {message !== null && (
        <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>
      )}
    </section>
  );
}
