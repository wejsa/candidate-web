import { describe, expect, it } from 'vitest';
import {
  maskAddress,
  maskBirthDate,
  maskEmail,
  maskName,
  maskPhone,
} from '@/lib/pii/mask';

describe('maskPhone', () => {
  it('masks 11-digit mobile (no hyphens)', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678');
  });

  it('masks 11-digit mobile (with hyphens)', () => {
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
  });

  it('masks Seoul landline (02, 10 digits)', () => {
    expect(maskPhone('0212345678')).toBe('02-****-5678');
  });

  it('masks Seoul landline (02, with hyphens)', () => {
    expect(maskPhone('02-1234-5678')).toBe('02-****-5678');
  });

  it('masks regional landline (031, 10 digits)', () => {
    expect(maskPhone('0311234567')).toBe('031-***-4567');
  });

  it('strips spaces and parens before masking', () => {
    expect(maskPhone('(010) 1234-5678')).toBe('010-****-5678');
  });

  it('returns null for null input', () => {
    expect(maskPhone(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(maskPhone(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(maskPhone('')).toBeNull();
  });

  it('returns null for too-short input (< 9 digits)', () => {
    expect(maskPhone('12345')).toBeNull();
  });

  it('masks 9-digit fallback (mask all but last 4)', () => {
    expect(maskPhone('123456789')).toBe('****-6789');
  });
});

describe('maskBirthDate', () => {
  it('masks ISO date string (YYYY-MM-DD) keeping year only', () => {
    expect(maskBirthDate('1995-03-15')).toBe('1995-**-**');
  });

  it('masks ISO datetime string (YYYY-MM-DDTHH:MM:SSZ)', () => {
    expect(maskBirthDate('1995-03-15T00:00:00Z')).toBe('1995-**-**');
  });

  it('masks Date object preserving UTC year', () => {
    expect(maskBirthDate(new Date('1995-03-15T00:00:00Z'))).toBe('1995-**-**');
  });

  it('returns null for null input', () => {
    expect(maskBirthDate(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(maskBirthDate(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(maskBirthDate('')).toBeNull();
  });

  it('returns null for invalid format string', () => {
    expect(maskBirthDate('not-a-date')).toBeNull();
  });

  it('returns null for invalid Date object', () => {
    expect(maskBirthDate(new Date('invalid'))).toBeNull();
  });
});

// CANDID-030 D5: H004 회귀 케이스 — Date.UTC normalize 로직 검증.
// 정규식만 매칭하던 이전 로직이라면 통과되었을 무효 날짜들이 모두 null이 되어야 함.
describe('maskBirthDate — 무효 날짜 회귀 (H004 fix)', () => {
  it.each([
    ['invalid month 1995-13-99', '1995-13-99'],
    ['invalid day 2026-02-30', '2026-02-30'],
    ['non-leap year 2023-02-29', '2023-02-29'],
    ['invalid day 31 in April 2026-04-31', '2026-04-31'],
    ['invalid month 00 in 2026-00-15', '2026-00-15'],
  ])('returns null for normalize-invalid: %s', (_label, input) => {
    expect(maskBirthDate(input)).toBeNull();
  });

  it('accepts leap year 2000-02-29', () => {
    expect(maskBirthDate('2000-02-29')).toBe('2000-**-**');
  });

  it('accepts last day of month 2026-01-31', () => {
    expect(maskBirthDate('2026-01-31')).toBe('2026-**-**');
  });
});

// === CANDID-034 (CANDID-005 FU1) Step 4 — Application snapshot mask 단위 테스트 ===

describe('maskName (CANDID-034 Step 4)', () => {
  it('masks Korean 3-char name to first char + **', () => {
    expect(maskName('홍길동')).toBe('홍**');
  });

  it('masks English name to first char + **', () => {
    expect(maskName('Kim')).toBe('K**');
  });

  it('preserves single-char name as-is (no leak risk)', () => {
    expect(maskName('A')).toBe('A');
    expect(maskName('홍')).toBe('홍');
  });

  it('returns null for null/undefined/empty/whitespace-only', () => {
    expect(maskName(null)).toBeNull();
    expect(maskName(undefined)).toBeNull();
    expect(maskName('')).toBeNull();
    expect(maskName('   ')).toBeNull();
  });

  it('trims surrounding whitespace before masking', () => {
    expect(maskName('  홍길동  ')).toBe('홍**');
  });

  it('handles long names (preserves only first char)', () => {
    expect(maskName('Christopher')).toBe('C**');
  });
});

describe('maskEmail (CANDID-034 Step 4)', () => {
  it('masks typical email to first char of local + *** + domain', () => {
    expect(maskEmail('foo@bar.com')).toBe('f***@bar.com');
  });

  it('handles single-char local part', () => {
    expect(maskEmail('a@bar.com')).toBe('a***@bar.com');
  });

  it('preserves multi-dot domain', () => {
    expect(maskEmail('jaeseong.sim85@gmail.com')).toBe('j***@gmail.com');
  });

  it('returns null on missing @ (invalid format)', () => {
    expect(maskEmail('foobar.com')).toBeNull();
  });

  it('returns null on @ at start (no local)', () => {
    expect(maskEmail('@bar.com')).toBeNull();
  });

  it('returns null on @ at end (no domain)', () => {
    expect(maskEmail('foo@')).toBeNull();
  });

  it('returns null on null/undefined/empty/whitespace-only', () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
    expect(maskEmail('')).toBeNull();
    expect(maskEmail('   ')).toBeNull();
  });

  it('trims surrounding whitespace before masking', () => {
    expect(maskEmail('  foo@bar.com  ')).toBe('f***@bar.com');
  });
});

describe('maskAddress (CANDID-034 Step 4)', () => {
  it('masks address with 4+ tokens to first 2 + ***', () => {
    expect(maskAddress('서울시 강남구 테헤란로 123')).toBe('서울시 강남구 ***');
  });

  it('masks 3-token address to first 2 + ***', () => {
    expect(maskAddress('서울시 강남구 역삼동')).toBe('서울시 강남구 ***');
  });

  it('preserves 2-token address as-is (no leak — partial info already minimal)', () => {
    expect(maskAddress('서울시 강남구')).toBe('서울시 강남구');
  });

  it('preserves 1-token address as-is', () => {
    expect(maskAddress('서울시')).toBe('서울시');
  });

  it('collapses multiple spaces between tokens', () => {
    expect(maskAddress('서울시    강남구    테헤란로')).toBe('서울시 강남구 ***');
  });

  it('handles English address (first 2 tokens preserved)', () => {
    expect(maskAddress('123 Main Street Springfield IL')).toBe('123 Main ***');
  });

  it('returns null on null/undefined/empty/whitespace-only', () => {
    expect(maskAddress(null)).toBeNull();
    expect(maskAddress(undefined)).toBeNull();
    expect(maskAddress('')).toBeNull();
    expect(maskAddress('   ')).toBeNull();
  });
});
