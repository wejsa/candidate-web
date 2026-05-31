'use client';

// CANDID-024 Step 2 — 프로필 수정 폼 Client Component (US-MY-004).
//
// 이름/연락처 입력 → PATCH /api/v1/users/me → 성공 시 router.refresh()로 RSC 재조회.
// 분기 로직(payload 빌드, 에러 분류)은 lib/users/profile-form.ts에 위임 (단위 테스트 SSOT).
// 현재 연락처는 마스킹 표시라 prefill 불가 — 입력 시에만 전송한다.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  PROFILE_EDIT_LABELS as L,
  buildProfileUpdatePayload,
  isEmptyPayload,
  classifyProfileUpdateError,
} from '@/lib/users/profile-form';

interface ProfileEditFormProps {
  initialName: string;
  phoneMasked: string | null;
}

interface FormState {
  status: 'idle' | 'pending' | 'done' | 'error';
  message: string | null;
}

export function ProfileEditForm({ initialName, phoneMasked }: ProfileEditFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<FormState>({ status: 'idle', message: null });

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    const payload = buildProfileUpdatePayload({ name, phone }, { name: initialName });
    if (isEmptyPayload(payload)) {
      setState({ status: 'error', message: L.noChange });
      return;
    }

    setState({ status: 'pending', message: null });
    let response: Response;
    try {
      response = await fetch('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setState({ status: 'error', message: L.errorGeneric });
      return;
    }

    if (response.status === 200) {
      setPhone('');
      setState({ status: 'done', message: L.saved });
      router.refresh();
      return;
    }

    setState({ status: 'error', message: classifyProfileUpdateError(response.status) });
  }

  return (
    <form onSubmit={submit} aria-labelledby="profile-edit-title">
      <h2 id="profile-edit-title">{L.heading}</h2>

      <label>
        {L.nameLabel}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </label>

      <label>
        {L.phoneLabel}
        <input
          type="tel"
          value={phone}
          inputMode="numeric"
          placeholder={phoneMasked !== null ? `현재: ${phoneMasked}` : L.phonePlaceholder}
          onChange={(e) => setPhone(e.target.value)}
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
