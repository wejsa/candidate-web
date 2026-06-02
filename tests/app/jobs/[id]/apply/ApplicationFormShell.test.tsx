// CANDID-040 Step 2 — ApplicationFormShell draftId 의미 정합 테스트 (RTL, jsdom).
//
// D-MAJOR-1 회귀 가드: ResumeUploadStep에 전달되는 draftId는 jobPostingId(jobId)가 아니라
//   application_drafts.id(draftDbId)여야 한다. 서버 issueResumePresign이 draftId로
//   applicationDraft.findUnique({ where: { id } })를 수행하므로, 공고 id를 넘기면 draft 조회가 어긋난다.
//
// 모킹 경계: ResumeUploadStep(prop 캡처) + 형제 컴포넌트/자동저장 훅(렌더 부수효과 차단).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { DraftPayloadV1, DraftPrefill } from '@/lib/drafts/types';

const resumeUploadSpy = vi.fn();

vi.mock('@/app/jobs/[id]/apply/_components/ResumeUploadStep', () => ({
  ResumeUploadStep: (props: { draftId: number }) => {
    resumeUploadSpy(props);
    return null;
  },
}));
vi.mock('@/app/jobs/[id]/apply/_components/PersonalInfoStep', () => ({
  PersonalInfoStep: () => null,
}));
vi.mock('@/app/jobs/[id]/apply/_components/StepNavigation', () => ({
  StepNavigation: () => null,
}));
vi.mock('@/app/jobs/[id]/apply/_components/AutoSaveIndicator', () => ({
  AutoSaveIndicator: () => null,
}));
vi.mock('@/lib/drafts/use-auto-save', () => ({
  useAutoSave: () => ({
    notifyChange: vi.fn(),
    saveNow: vi.fn(),
    status: 'idle',
    lastSavedAt: null,
    version: 1,
    errorMessage: null,
  }),
}));

import { ApplicationFormShell } from '@/app/jobs/[id]/apply/_components/ApplicationFormShell';

// currentStep=2로 진입 → ResumeUploadStep이 즉시 렌더된다. step1_personal은 옵셔널이라 생략.
const payloadAtStep2: DraftPayloadV1 = {
  schemaVersion: 1,
  meta: { currentStep: 2, completedSteps: [1] },
};
const prefill: DraftPrefill = { email: 'a@example.com', name: null, phone: null, birthDate: null };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ApplicationFormShell — draftId 의미 정합 (D-MAJOR-1 / CANDID-040)', () => {
  it('ResumeUploadStep에 jobId가 아닌 draftDbId(application_drafts.id)를 전달', () => {
    render(
      <ApplicationFormShell
        jobId={7}
        draftDbId={12345}
        initialPayload={payloadAtStep2}
        initialVersion={1}
        initialLastSavedAt="2026-06-02T00:00:00Z"
        prefill={prefill}
      />,
    );

    expect(resumeUploadSpy).toHaveBeenCalled();
    const props = resumeUploadSpy.mock.calls[0]![0] as { draftId: number };
    expect(props.draftId).toBe(12345); // draftDbId (application_drafts.id)
    expect(props.draftId).not.toBe(7); // jobPostingId가 아니어야 함 (버그 회귀 가드)
  });
});
