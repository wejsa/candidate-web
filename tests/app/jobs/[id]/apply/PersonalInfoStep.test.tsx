// CANDID-028 Step 3 — PersonalInfoStep 폼 에러 연관 회귀 테스트 (RTL, jsdom).
// 검증: 필드별 에러가 input↔span을 id+aria-describedby로 일관 연결(WCAG 3.3.1).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonalInfoStep } from '@/app/jobs/[id]/apply/_components/PersonalInfoStep';
import type { DraftPrefill } from '@/lib/drafts/types';

const prefill: DraftPrefill = { email: 'a@b.com', name: null, phone: null, birthDate: null };

afterEach(() => {
  cleanup();
});

describe('PersonalInfoStep 에러 연관', () => {
  it('잘못된 연락처 → input aria-invalid + aria-describedby=err-phone, 에러 span id 일치', async () => {
    const { container } = render(
      <PersonalInfoStep value={undefined} prefill={prefill} onChange={vi.fn()} />,
    );
    const phone = container.querySelector('input[type="tel"]') as HTMLInputElement;
    await userEvent.type(phone, 'abc'); // PHONE_REGEX 위반

    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(phone).toHaveAttribute('aria-describedby', 'err-phone');
    const err = document.getElementById('err-phone');
    expect(err).not.toBeNull();
    expect(err).toHaveAttribute('role', 'alert');
  });
});
