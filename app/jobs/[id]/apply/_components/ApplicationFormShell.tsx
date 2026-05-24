// CANDID-015 Step 3 — 3-step Stepper Shell (client).
// 현재 step 라우팅 + 진행률 (33/66/100). Step 2/3 본문은 CANDID-016/017/018 위임.

'use client';

import { useState } from 'react';
import type { ApplicationStep, DraftPayloadV1, DraftPrefill } from '@/lib/drafts/types';
import { PersonalInfoStep } from './PersonalInfoStep';
import { StepNavigation } from './StepNavigation';

interface Props {
  jobId: number;
  initialPayload: DraftPayloadV1;
  initialVersion: number;
  initialLastSavedAt: string;
  prefill: DraftPrefill;
}

const STEPS: { step: ApplicationStep; label: string }[] = [
  { step: 1, label: '인적사항' },
  { step: 2, label: '이력서 · 포트폴리오' },
  { step: 3, label: '자기소개 · 추가 질문' },
];

export function ApplicationFormShell({
  jobId,
  initialPayload,
  initialVersion,
  initialLastSavedAt,
  prefill,
}: Props) {
  const [payload, setPayload] = useState<DraftPayloadV1>(initialPayload);
  const [currentStep, setCurrentStep] = useState<ApplicationStep>(
    initialPayload.meta.currentStep,
  );
  const progress = Math.round((currentStep / 3) * 100);

  const handleStep1Change = (step1: DraftPayloadV1['step1_personal']) => {
    setPayload((p) => ({ ...p, step1_personal: step1 }));
  };

  const handleStepMove = (next: ApplicationStep) => {
    setCurrentStep(next);
    setPayload((p) => ({ ...p, meta: { ...p.meta, currentStep: next } }));
  };

  return (
    <article aria-label="지원서 작성">
      <header>
        <h1>지원서 작성</h1>
        <p aria-label="진행률" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          {progress}% · Step {currentStep}/3
        </p>
        <ol>
          {STEPS.map((s) => (
            <li key={s.step} aria-current={s.step === currentStep ? 'step' : undefined}>
              <button
                type="button"
                onClick={() => handleStepMove(s.step)}
                disabled={s.step > currentStep && !payload.meta.completedSteps.includes(s.step)}
              >
                {s.step}. {s.label}
              </button>
            </li>
          ))}
        </ol>
      </header>

      <section aria-label={`Step ${currentStep}`}>
        {currentStep === 1 && (
          <PersonalInfoStep
            value={payload.step1_personal}
            prefill={prefill}
            onChange={handleStep1Change}
          />
        )}
        {currentStep === 2 && (
          <p>이력서 · 포트폴리오 단계 (CANDID-016/017에서 구현 예정)</p>
        )}
        {currentStep === 3 && (
          <p>자기소개 · 추가 질문 단계 (CANDID-018에서 구현 예정)</p>
        )}
      </section>

      <StepNavigation
        currentStep={currentStep}
        onPrev={() => handleStepMove(Math.max(1, currentStep - 1) as ApplicationStep)}
        onNext={() => handleStepMove(Math.min(3, currentStep + 1) as ApplicationStep)}
      />
      {/* CANDID-015 Step 4: 자동 저장 hook + AutoSaveIndicator 통합 예정 */}
      <small aria-live="polite">
        마지막 저장: {new Date(initialLastSavedAt).toLocaleString('ko-KR')} · v{initialVersion} · jobId={jobId}
      </small>
    </article>
  );
}
