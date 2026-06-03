// CANDID-014 Step 3 — 5-state CTA UI (client).
// state는 서버(RSC)에서 resolveApplyCta로 결정 후 props로 내려옴 → 본 컴포넌트는 네비게이션만 담당.

'use client';

import Link from 'next/link';
import type { ApplyCtaState } from '@/lib/jobs/apply-cta';

interface Props {
  jobId: number;
  state: ApplyCtaState;
  applicationNumber?: string;
}

const LABEL: Record<ApplyCtaState, string> = {
  GUEST: '로그인하고 지원하기',
  APPLY: '지원하기',
  RESUME_DRAFT: '이어서 작성하기',
  ALREADY_APPLIED: '지원 완료',
  CLOSED: '지원 마감',
};

export function ApplyCta({ jobId, state, applicationNumber }: Props) {
  const applyPath = `/jobs/${jobId}/apply`;

  // 1) 마감 / 이미 지원 — 비활성 버튼 + 보조 액션 링크
  if (state === 'CLOSED') {
    return (
      <div>
        <button type="button" disabled aria-disabled="true">
          {LABEL.CLOSED}
        </button>
      </div>
    );
  }
  if (state === 'ALREADY_APPLIED') {
    return (
      <div>
        <button type="button" disabled aria-disabled="true">
          {LABEL.ALREADY_APPLIED}
        </button>
        <Link
          href="/me"
          aria-label={
            applicationNumber !== undefined
              ? `마이페이지에서 ${applicationNumber} 확인`
              : '마이페이지에서 확인'
          }
        >
          마이페이지에서 확인
        </Link>
      </div>
    );
  }

  // 2) 비로그인 — 로그인 페이지로 이동 (redirect 보존)
  if (state === 'GUEST') {
    const redirect = encodeURIComponent(applyPath);
    return (
      <Link href={`/login?redirect=${redirect}`} role="button">
        {LABEL.GUEST}
      </Link>
    );
  }

  // 3) 신규 지원 / 이어서 작성
  return (
    <Link href={applyPath} role="button">
      {state === 'RESUME_DRAFT' ? LABEL.RESUME_DRAFT : LABEL.APPLY}
    </Link>
  );
}
