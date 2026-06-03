// CANDID — 지원서 작성 단일 페이지 (첨부 + 지원).
//
// 재구성: 3-step stepper / 인적사항 입력 UI 제거(US 요청).
//   - 인적사항(name/phone/birthDate)은 프로필 PII(prefill)에서 자동 채움 → 제출 시 draft payload에 기입.
//     prefill 미완성이면 제출 차단 + 프로필 완성 안내(게이트).
//   - careerLevel(신입/경력)은 프로필에 없어 본 페이지에서 1개 선택 유지(EXPERIENCED는 careerMonths 필수).
//   - 첨부: 이력서 파일 1개(필수) + 포트폴리오/경력 링크(선택).
//   - 제출: PUT draft(step1_personal 기입) → POST /api/v1/applications(Idempotency-Key + consent).

'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { CareerLevel, DraftPayloadV1, DraftPrefill } from '@/lib/drafts/types';
import { ResumeUploadStep } from './ResumeUploadStep';
import { PortfolioLinksSection } from './PortfolioLinksSection';
import styles from '@/app/jobs/[id]/apply/apply.module.css';

interface Props {
  jobId: number;
  jobTitle: string;
  draftDbId: number;
  initialPayload: DraftPayloadV1;
  initialVersion: number;
  prefill: DraftPrefill;
  initialResumeAttached: boolean;
  initialPortfolioLinks: { linkType: string; url: string; memo: string | null }[];
}

/** 연락처를 draft 스키마(010-XXXX-XXXX)에 맞게 정규화. 숫자 11자리(010…)만 변환, 그 외는 원본 유지. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('010')) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

type SubmitStatus = 'idle' | 'submitting' | 'error' | 'done';

export function ApplicationFormShell({
  jobId,
  jobTitle,
  draftDbId,
  initialPayload,
  initialVersion,
  prefill,
  initialResumeAttached,
  initialPortfolioLinks,
}: Props) {
  const versionRef = useRef(initialVersion);

  const [resumeAttached, setResumeAttached] = useState(initialResumeAttached);
  const [careerLevel, setCareerLevel] = useState<CareerLevel | null>(
    initialPayload.step1_personal?.careerLevel ?? null,
  );
  const [careerMonths, setCareerMonths] = useState<string>(
    initialPayload.step1_personal?.careerMonths?.toString() ?? '',
  );
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [appNumber, setAppNumber] = useState<string | null>(null);

  // 프로필에서 가져온 인적사항 완성도 (제출 필수 — name/phone/birthDate).
  const personalReady =
    prefill.name !== null &&
    prefill.name.trim() !== '' &&
    prefill.phone !== null &&
    prefill.phone.trim() !== '' &&
    prefill.birthDate !== null &&
    prefill.birthDate.trim() !== '';

  const careerReady =
    careerLevel === 'NEW' || (careerLevel === 'EXPERIENCED' && careerMonths.trim() !== '');

  const canSubmit =
    personalReady && resumeAttached && careerReady && consent && status !== 'submitting';

  async function handleSubmit() {
    if (!canSubmit) return;
    setStatus('submitting');
    setErrorMsg(null);

    // 1) 프로필 PII + careerLevel을 draft payload(step1_personal)에 기입 후 저장.
    const step1 = {
      name: prefill.name as string,
      phone: normalizePhone(prefill.phone as string),
      birthDate: prefill.birthDate as string,
      careerLevel: careerLevel as CareerLevel,
      ...(careerLevel === 'EXPERIENCED'
        ? { careerMonths: Number.parseInt(careerMonths, 10) }
        : {}),
    };
    const nextPayload: DraftPayloadV1 = {
      ...initialPayload,
      step1_personal: step1,
    };

    try {
      const putRes = await fetch(`/api/v1/drafts/${jobId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: nextPayload, version: versionRef.current }),
      });
      if (!putRes.ok) {
        setStatus('error');
        setErrorMsg(
          putRes.status === 409
            ? '지원서가 다른 곳에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.'
            : '지원 정보를 저장하지 못했습니다. 프로필의 연락처·생년월일 형식을 확인해 주세요.',
        );
        return;
      }
      const putBody = (await putRes.json()) as { version?: number };
      if (typeof putBody.version === 'number') versionRef.current = putBody.version;

      // 2) 최종 제출 (멱등성 키 + consent).
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${jobId}-${versionRef.current}-${Math.round(performance.now())}`;
      const subRes = await fetch('/api/v1/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ jobPostingId: jobId, consent: true }),
      });

      if (subRes.status === 201) {
        const body = (await subRes.json()) as { applicationNumber?: string };
        setAppNumber(body.applicationNumber ?? null);
        setStatus('done');
        return;
      }
      // 에러 분기 — 코드별 사용자 안내.
      let code: string | null = null;
      try {
        const body = (await subRes.json()) as { code?: string };
        code = typeof body.code === 'string' ? body.code : null;
      } catch {
        /* 무시 */
      }
      setStatus('error');
      setErrorMsg(submitErrorMessage(code, subRes.status));
    } catch {
      setStatus('error');
      setErrorMsg('네트워크 오류로 제출하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  if (status === 'done') {
    return (
      <div className={styles.success} role="status" aria-live="polite">
        <h1 className={styles.successTitle}>지원이 완료되었습니다</h1>
        {appNumber !== null && (
          <p>
            지원 번호: <strong>{appNumber}</strong>
          </p>
        )}
        <p>전형 진행 상황은 마이페이지에서 확인할 수 있습니다.</p>
        <p>
          <Link href="/me">마이페이지로 이동</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.heroEyebrow}>지원서 작성</p>
        <h1 className={styles.heroTitle}>지원하기</h1>
        <p className={styles.heroJob}>{jobTitle}</p>
      </header>

      {!personalReady && (
        <div className={styles.gate} role="alert">
          <p className={styles.gateTitle}>프로필을 먼저 완성해 주세요</p>
          <p>
            지원서 제출에는 프로필의 이름·연락처·생년월일이 필요합니다. 프로필에서 정보를 채운 뒤
            다시 지원해 주세요.
          </p>
          <p>
            <Link href="/me/profile">프로필 수정하러 가기</Link>
          </p>
        </div>
      )}

      <ResumeUploadStep
        draftId={draftDbId}
        className={styles.resumeFieldset}
        onAttached={() => setResumeAttached(true)}
        onCleared={() => setResumeAttached(false)}
      />

      <PortfolioLinksSection jobId={jobId} initialLinks={initialPortfolioLinks} />

      <fieldset className={styles.card}>
        <legend>지원 구분</legend>
        <p className={styles.cardHint}>신입/경력을 선택해 주세요.</p>
        <div className={styles.choiceRow}>
          <label className={styles.choice}>
            <input
              type="radio"
              name="careerLevel"
              checked={careerLevel === 'NEW'}
              onChange={() => setCareerLevel('NEW')}
            />
            신입
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="careerLevel"
              checked={careerLevel === 'EXPERIENCED'}
              onChange={() => setCareerLevel('EXPERIENCED')}
            />
            경력
          </label>
        </div>
        {careerLevel === 'EXPERIENCED' && (
          <label>
            총 경력 (개월)
            <input
              type="number"
              min={0}
              max={720}
              value={careerMonths}
              onChange={(e) => setCareerMonths(e.target.value)}
              placeholder="예: 36"
            />
          </label>
        )}
      </fieldset>

      <div className={styles.submitBar}>
        <ul className={styles.checklist}>
          <li className={`${styles.checkItem} ${personalReady ? styles.ok : ''}`}>
            <span className={styles.checkMark} aria-hidden="true">
              {personalReady ? '✓' : ''}
            </span>
            인적사항 (프로필에서 자동 적용)
          </li>
          <li className={`${styles.checkItem} ${resumeAttached ? styles.ok : ''}`}>
            <span className={styles.checkMark} aria-hidden="true">
              {resumeAttached ? '✓' : ''}
            </span>
            이력서 첨부
          </li>
          <li className={`${styles.checkItem} ${careerReady ? styles.ok : ''}`}>
            <span className={styles.checkMark} aria-hidden="true">
              {careerReady ? '✓' : ''}
            </span>
            지원 구분 선택
          </li>
        </ul>

        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          지원서 내용과 개인정보 제공에 동의하며 제출합니다.
        </label>

        <button
          type="button"
          className={styles.submitBtn}
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
        >
          {status === 'submitting' ? '제출 중…' : '지원하기'}
        </button>

        {status === 'error' && errorMsg !== null && (
          <p className={styles.submitError} role="alert">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
}

/** submit 실패 코드 → 사용자 안내 메시지. */
function submitErrorMessage(code: string | null, httpStatus: number): string {
  switch (code) {
    case 'AUTH_EMAIL_NOT_VERIFIED':
      return '이메일 인증 후 지원할 수 있습니다. 가입 시 받은 인증 메일을 확인해 주세요.';
    case 'APP_ALREADY_SUBMITTED':
      return '이미 이 공고에 지원하셨습니다. 마이페이지에서 확인해 주세요.';
    case 'APP_DEADLINE_PASSED':
    case 'JOB_CLOSED':
      return '지원이 마감된 공고입니다.';
    case 'APP_SUBMIT_INCOMPLETE':
      return '이력서·인적사항 등 필수 항목을 다시 확인해 주세요.';
    default:
      return httpStatus >= 500
        ? '일시적인 오류로 제출하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : '지원서를 제출하지 못했습니다. 입력 내용을 확인해 주세요.';
  }
}
