// CANDID-015 Step 1 — lib/drafts/schema 단위 테스트.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  PersonalInfoSchema,
  DraftPayloadV1Schema,
  DraftPutRequestSchema,
  JobPostingIdParamSchema,
  initialPayload,
} from '@/lib/drafts/schema';

const NOW = new Date('2026-05-24T00:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const validPersonalInfo = {
  name: '홍길동',
  phone: '010-1234-5678',
  birthDate: '2000-01-01',
  careerLevel: 'NEW' as const,
};

describe('PersonalInfoSchema — happy path', () => {
  it('필수 필드만 (NEW, 14세 이상)', () => {
    const result = PersonalInfoSchema.safeParse(validPersonalInfo);
    expect(result.success).toBe(true);
  });

  it('전체 필드 + EXPERIENCED + careerMonths', () => {
    const result = PersonalInfoSchema.safeParse({
      ...validPersonalInfo,
      address: '서울시 강남구',
      careerLevel: 'EXPERIENCED',
      careerMonths: 36,
      education: 'BACHELOR',
    });
    expect(result.success).toBe(true);
  });

  it('영문 이름 통과', () => {
    const result = PersonalInfoSchema.safeParse({ ...validPersonalInfo, name: 'John Doe' });
    expect(result.success).toBe(true);
  });
});

describe('PersonalInfoSchema — validation 실패', () => {
  it('이름 한자 차단', () => {
    const result = PersonalInfoSchema.safeParse({ ...validPersonalInfo, name: '張三' });
    expect(result.success).toBe(false);
  });

  it('이름 1자 차단', () => {
    const result = PersonalInfoSchema.safeParse({ ...validPersonalInfo, name: '김' });
    expect(result.success).toBe(false);
  });

  it('이름 51자 차단', () => {
    const result = PersonalInfoSchema.safeParse({ ...validPersonalInfo, name: '가'.repeat(51) });
    expect(result.success).toBe(false);
  });

  it('연락처 011 형식 차단', () => {
    const result = PersonalInfoSchema.safeParse({ ...validPersonalInfo, phone: '011-1234-5678' });
    expect(result.success).toBe(false);
  });

  it('연락처 하이픈 없음 차단', () => {
    const result = PersonalInfoSchema.safeParse({ ...validPersonalInfo, phone: '01012345678' });
    expect(result.success).toBe(false);
  });

  it('생년월일 잘못된 형식 차단', () => {
    const result = PersonalInfoSchema.safeParse({ ...validPersonalInfo, birthDate: '2000/01/01' });
    expect(result.success).toBe(false);
  });

  it('만 14세 미만 차단 (BR-PII-05)', () => {
    // NOW=2026-05-24 → 14세 미만 = 2012-05-25 이후
    const result = PersonalInfoSchema.safeParse({ ...validPersonalInfo, birthDate: '2013-01-01' });
    expect(result.success).toBe(false);
  });

  it('EXPERIENCED + careerMonths 누락 → 차단 (US-APP-002)', () => {
    const result = PersonalInfoSchema.safeParse({
      ...validPersonalInfo,
      careerLevel: 'EXPERIENCED',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('careerMonths');
    }
  });

  it('careerMonths 음수 차단', () => {
    const result = PersonalInfoSchema.safeParse({
      ...validPersonalInfo,
      careerLevel: 'EXPERIENCED',
      careerMonths: -1,
    });
    expect(result.success).toBe(false);
  });

  it('careerMonths 720 초과 차단', () => {
    const result = PersonalInfoSchema.safeParse({
      ...validPersonalInfo,
      careerLevel: 'EXPERIENCED',
      careerMonths: 721,
    });
    expect(result.success).toBe(false);
  });

  it('education 잘못된 값 차단', () => {
    const result = PersonalInfoSchema.safeParse({
      ...validPersonalInfo,
      education: 'UNKNOWN',
    });
    expect(result.success).toBe(false);
  });
});

describe('DraftPayloadV1Schema', () => {
  it('schemaVersion=1 강제', () => {
    const result = DraftPayloadV1Schema.safeParse({
      schemaVersion: 2,
      meta: { currentStep: 1, completedSteps: [] },
    });
    expect(result.success).toBe(false);
  });

  it('initialPayload는 schema 통과', () => {
    const result = DraftPayloadV1Schema.safeParse(initialPayload());
    expect(result.success).toBe(true);
  });

  it('step1_personal 포함 통과', () => {
    const result = DraftPayloadV1Schema.safeParse({
      schemaVersion: 1,
      meta: { currentStep: 2, completedSteps: [1] },
      step1_personal: validPersonalInfo,
    });
    expect(result.success).toBe(true);
  });

  it('currentStep 4 차단', () => {
    const result = DraftPayloadV1Schema.safeParse({
      schemaVersion: 1,
      meta: { currentStep: 4, completedSteps: [] },
    });
    expect(result.success).toBe(false);
  });
});

describe('DraftPutRequestSchema', () => {
  it('version=0 (신규) 통과', () => {
    const result = DraftPutRequestSchema.safeParse({ payload: initialPayload(), version: 0 });
    expect(result.success).toBe(true);
  });

  it('version 음수 차단', () => {
    const result = DraftPutRequestSchema.safeParse({ payload: initialPayload(), version: -1 });
    expect(result.success).toBe(false);
  });
});

describe('JobPostingIdParamSchema', () => {
  it('정수 문자열 → coerce 통과', () => {
    const result = JobPostingIdParamSchema.parse({ jobPostingId: '42' });
    expect(result.jobPostingId).toBe(42);
  });

  it('0 차단', () => {
    const result = JobPostingIdParamSchema.safeParse({ jobPostingId: '0' });
    expect(result.success).toBe(false);
  });

  it('소수 차단', () => {
    const result = JobPostingIdParamSchema.safeParse({ jobPostingId: '1.5' });
    expect(result.success).toBe(false);
  });

  it('INT4 초과 차단', () => {
    const result = JobPostingIdParamSchema.safeParse({ jobPostingId: '2147483648' });
    expect(result.success).toBe(false);
  });
});

describe('initialPayload', () => {
  it('schemaVersion=1, currentStep=1, completedSteps=[]', () => {
    const p = initialPayload();
    expect(p.schemaVersion).toBe(1);
    expect(p.meta.currentStep).toBe(1);
    expect(p.meta.completedSteps).toEqual([]);
    expect(p.step1_personal).toBeUndefined();
  });
});
