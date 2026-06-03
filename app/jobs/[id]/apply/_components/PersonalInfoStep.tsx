// CANDID-015 Step 3 — Step 1 인적사항 폼 (client, US-APP-002).
// controlled state + zod 검증 (PersonalInfoSchema 재사용).

'use client';

import { useState, type ChangeEvent } from 'react';
import { PersonalInfoSchema } from '@/lib/drafts/schema';
import type { PersonalInfoPayload, DraftPrefill } from '@/lib/drafts/types';

interface Props {
  value: PersonalInfoPayload | undefined;
  prefill: DraftPrefill;
  onChange: (next: PersonalInfoPayload) => void;
}

// `payload[field] ?? prefill[field]` 폼 초기화 — lazy stick 정책 (db-designer 권고).
function withPrefill(
  value: PersonalInfoPayload | undefined,
  prefill: DraftPrefill,
): PersonalInfoPayload {
  return {
    name: value?.name ?? prefill.name ?? '',
    phone: value?.phone ?? prefill.phone ?? '',
    birthDate: value?.birthDate ?? prefill.birthDate ?? '',
    address: value?.address,
    careerLevel: value?.careerLevel ?? 'NEW',
    careerMonths: value?.careerMonths,
    education: value?.education,
  };
}

export function PersonalInfoStep({ value, prefill, onChange }: Props) {
  const [draft, setDraft] = useState<PersonalInfoPayload>(() => withPrefill(value, prefill));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = <K extends keyof PersonalInfoPayload>(key: K, v: PersonalInfoPayload[K]) => {
    const next = { ...draft, [key]: v };
    setDraft(next);
    // 즉시 zod 검증 — 폼 단계 클라이언트 사전 차단
    const result = PersonalInfoSchema.safeParse(next);
    if (result.success) {
      setErrors({});
      onChange(next);
    } else {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path[0];
        if (typeof path === 'string' && fieldErrors[path] === undefined) {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      // 부분 입력이라도 onChange는 호출 (자동 저장 대상) — 서버가 zod refine으로 최종 검증
      onChange(next);
    }
  };

  return (
    <form aria-label="인적사항 입력">
      <fieldset>
        <label>
          이름 <span aria-label="필수">*</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('name', e.target.value)}
            aria-invalid={errors.name !== undefined}
            aria-describedby={errors.name !== undefined ? 'err-name' : undefined}
            required
          />
          {errors.name !== undefined && <span id="err-name" role="alert">{errors.name}</span>}
        </label>

        <label>
          이메일 (수정 불가)
          <input type="email" value={prefill.email} disabled readOnly />
        </label>

        <label>
          연락처 <span aria-label="필수">*</span>
          <input
            type="tel"
            value={draft.phone}
            placeholder="010-XXXX-XXXX"
            onChange={(e) => update('phone', e.target.value)}
            aria-invalid={errors.phone !== undefined}
            aria-describedby={errors.phone !== undefined ? 'err-phone' : undefined}
            required
          />
          {errors.phone !== undefined && (
            <span id="err-phone" role="alert">
              {errors.phone}
            </span>
          )}
        </label>

        <label>
          생년월일 <span aria-label="필수">*</span> (만 14세 이상)
          <input
            type="date"
            value={draft.birthDate}
            onChange={(e) => update('birthDate', e.target.value)}
            aria-invalid={errors.birthDate !== undefined}
            aria-describedby={errors.birthDate !== undefined ? 'err-birthDate' : undefined}
            required
          />
          {errors.birthDate !== undefined && (
            <span id="err-birthDate" role="alert">
              {errors.birthDate}
            </span>
          )}
        </label>

        <label>
          주소
          <input
            type="text"
            value={draft.address ?? ''}
            onChange={(e) => update('address', e.target.value || undefined)}
          />
        </label>

        <label>
          경력 구분 <span aria-label="필수">*</span>
          <select
            value={draft.careerLevel}
            onChange={(e) => update('careerLevel', e.target.value as PersonalInfoPayload['careerLevel'])}
          >
            <option value="NEW">신입</option>
            <option value="EXPERIENCED">경력</option>
          </select>
        </label>

        {draft.careerLevel === 'EXPERIENCED' && (
          <label>
            총 경력 개월 수 <span aria-label="필수">*</span>
            <input
              type="number"
              min="0"
              max="720"
              value={draft.careerMonths ?? ''}
              onChange={(e) => {
                const n = e.target.value === '' ? undefined : Number(e.target.value);
                update('careerMonths', n);
              }}
              aria-invalid={errors.careerMonths !== undefined}
              aria-describedby={errors.careerMonths !== undefined ? 'err-careerMonths' : undefined}
              required
            />
            {errors.careerMonths !== undefined && (
              <span id="err-careerMonths" role="alert">
                {errors.careerMonths}
              </span>
            )}
          </label>
        )}

        <label>
          최종 학력
          <select
            value={draft.education ?? ''}
            onChange={(e) => {
              const v = e.target.value as PersonalInfoPayload['education'] | '';
              update('education', v === '' ? undefined : v);
            }}
          >
            <option value="">선택</option>
            <option value="HIGH_SCHOOL">고졸</option>
            <option value="ASSOCIATE">전문대졸</option>
            <option value="BACHELOR">학사</option>
            <option value="MASTER">석사</option>
            <option value="DOCTORATE">박사</option>
          </select>
        </label>
      </fieldset>
    </form>
  );
}
