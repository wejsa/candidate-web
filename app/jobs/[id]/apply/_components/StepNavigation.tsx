// CANDID-015 Step 3 — Step Navigation (client).
// 이전/다음 버튼. 자동 저장 강제 트리거는 Step 4 hook에서 통합 예정.

'use client';

import type { ApplicationStep } from '@/lib/drafts/types';

interface Props {
  currentStep: ApplicationStep;
  onPrev: () => void;
  onNext: () => void;
}

export function StepNavigation({ currentStep, onPrev, onNext }: Props) {
  const isFirst = currentStep === 1;
  const isLast = currentStep === 3;
  return (
    <nav aria-label="단계 이동">
      <button
        type="button"
        onClick={onPrev}
        disabled={isFirst}
        aria-disabled={isFirst}
      >
        이전
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={isLast}
        aria-disabled={isLast}
      >
        {isLast ? '제출(Step 4 통합)' : '다음'}
      </button>
    </nav>
  );
}
