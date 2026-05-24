// CANDID-015 Step 1 — lib/validation/age 단위 테스트.

import { describe, expect, it } from 'vitest';
import {
  calculateAge,
  validateMinAge,
  toIsoDate,
  MIN_AGE_FOR_APPLICATION,
} from '@/lib/validation/age';

describe('MIN_AGE_FOR_APPLICATION', () => {
  it('14 (BR-PII-05)', () => {
    expect(MIN_AGE_FOR_APPLICATION).toBe(14);
  });
});

describe('calculateAge', () => {
  it('생일 전: 만 나이 -1', () => {
    const birth = new Date('2010-05-25T00:00:00Z');
    const now = new Date('2026-05-24T00:00:00Z');
    expect(calculateAge(birth, now)).toBe(15); // 16 - 1 = 15
  });

  it('생일 당일: 만 나이 +1', () => {
    const birth = new Date('2010-05-24T00:00:00Z');
    const now = new Date('2026-05-24T00:00:00Z');
    expect(calculateAge(birth, now)).toBe(16);
  });

  it('생일 다음 날', () => {
    const birth = new Date('2010-05-23T00:00:00Z');
    const now = new Date('2026-05-24T00:00:00Z');
    expect(calculateAge(birth, now)).toBe(16);
  });

  it('같은 해 같은 달, 다른 일자 (생일 후)', () => {
    const birth = new Date('1990-01-10T00:00:00Z');
    const now = new Date('2026-01-15T00:00:00Z');
    expect(calculateAge(birth, now)).toBe(36);
  });

  it('윤년 2월 29일 출생', () => {
    const birth = new Date('2000-02-29T00:00:00Z');
    const now = new Date('2026-03-01T00:00:00Z');
    expect(calculateAge(birth, now)).toBe(26);
  });
});

describe('validateMinAge — 만 14세 (기본값)', () => {
  const NOW = new Date('2026-05-24T00:00:00Z');

  it('정확히 만 14세 (14년 + 1일 전 생일) → true', () => {
    expect(validateMinAge('2012-05-23', 14, NOW)).toBe(true);
  });

  it('정확히 만 14세 (생일 당일) → true', () => {
    expect(validateMinAge('2012-05-24', 14, NOW)).toBe(true);
  });

  it('만 14세 - 1일 (생일 미도래) → false', () => {
    expect(validateMinAge('2012-05-25', 14, NOW)).toBe(false);
  });

  it('만 13세 → false', () => {
    expect(validateMinAge('2013-01-01', 14, NOW)).toBe(false);
  });

  it('잘못된 형식 (YYYY-M-D) → false', () => {
    expect(validateMinAge('2010-5-1', 14, NOW)).toBe(false);
  });

  it('빈 문자열 → false', () => {
    expect(validateMinAge('', 14, NOW)).toBe(false);
  });

  it('미래 생년월일 → false', () => {
    expect(validateMinAge('2030-01-01', 14, NOW)).toBe(false);
  });

  it('잘못된 날짜 (2026-13-01) → false', () => {
    expect(validateMinAge('2026-13-01', 14, NOW)).toBe(false);
  });
});

describe('toIsoDate', () => {
  it('UTC 기준 YYYY-MM-DD', () => {
    expect(toIsoDate(new Date('2026-05-24T15:30:00Z'))).toBe('2026-05-24');
  });

  it('자정 경계', () => {
    expect(toIsoDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});
