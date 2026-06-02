// CANDID-015 Step 3 — 3-step Stepper Shell (client).
// 현재 step 라우팅 + 진행률 (33/66/100). Step 2/3 본문은 CANDID-016/017/018 위임.

'use client';

import { useEffect, useState } from 'react';
import type { ApplicationStep, DraftPayloadV1, DraftPrefill } from '@/lib/drafts/types';
import { useAutoSave } from '@/lib/drafts/use-auto-save';
import { PersonalInfoStep } from './PersonalInfoStep';
import { StepNavigation } from './StepNavigation';
import { AutoSaveIndicator } from './AutoSaveIndicator';
// CANDID-016 Step 3: Step 2(이력서 첨부) 본문 통합.
import { ResumeUploadStep } from './ResumeUploadStep';

interface Props {
  jobId: number;
  /**
   * application_drafts.id (DB PK). D-MAJOR-1 fix (CANDID-040): ResumeUploadStep이 presign/confirm에
   * 전달하는 draftId는 jobPostingId가 아니라 **draft DB id**여야 한다(서버 issueResumePresign이
   * applicationDraft.findUnique({where:{id}})로 조회). jobId(공고 id)는 autoSave의 jobPostingId 용도로만 사용.
   */
  draftDbId: number;
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
  draftDbId,
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

  // CANDID-015 Step 4: 자동 저장 hook 통합
  const autoSave = useAutoSave({
    jobPostingId: jobId,
    initialVersion,
    initialLastSavedAt,
  });

  // payload 변경 시 hook에 알림 (debounce 3s + interval 30s 자동 트리거)
  useEffect(() => {
    autoSave.notifyChange(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const handleStep1Change = (step1: DraftPayloadV1['step1_personal']) => {
    setPayload((p) => ({ ...p, step1_personal: step1 }));
  };

  // CANDID-015 Step 4 L-019 (D-MAJOR-2): stepper completedSteps 갱신.
  // 앞으로 이동 시 현재 step을 completedSteps에 추가 — 뒤로 갔다가 다시 앞으로 가능.
  // 스텝 이동 시 강제 저장 (US-APP-005 "스텝 이동 시 강제 저장").
  const handleStepMove = (next: ApplicationStep) => {
    setCurrentStep(next);
    setPayload((p) => {
      const isAdvancing = next > p.meta.currentStep;
      const completedSteps = isAdvancing
        ? Array.from(new Set([...p.meta.completedSteps, p.meta.currentStep])).sort() as ApplicationStep[]
        : p.meta.completedSteps;
      return { ...p, meta: { ...p.meta, currentStep: next, completedSteps } };
    });
    void autoSave.saveNow();
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
          <ResumeUploadStep
            draftId={draftDbId}
            onAttached={() => {
              // ResumeFile 메타는 서버 DB(resume_files.draft_id)로 직접 연결되므로 payload 갱신 불요.
              // CANDID-018 최종 제출 시 BR-TX-01 단일 트랜잭션으로 draft → application 이관.
            }}
          />
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
      <AutoSaveIndicator
        status={autoSave.status}
        lastSavedAt={autoSave.lastSavedAt}
        version={autoSave.version}
        errorMessage={autoSave.errorMessage}
        onSaveNow={() => void autoSave.saveNow()}
      />
    </article>
  );
}
