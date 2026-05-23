import { describe, expect, it } from 'vitest';
import {
  SignupInputSchema,
  VerifyEmailInputSchema,
  hasThreeOfFourCharClasses,
} from '@/lib/auth/validation';

// BR-AUTH-01 (이메일 소문자) + US-AUTH-001 비밀번호 규칙 + BR-PII-05 옵션 C 검증.

describe('hasThreeOfFourCharClasses', () => {
  it.each([
    ['Abcd1234!@', true], // 대/소/숫/특 4종
    ['Abcd1234', true], // 대/소/숫 3종
    ['abcd1234!@', true], // 소/숫/특 3종
    ['Abcdefgh!@', true], // 대/소/특 3종
    ['Abcdefghij', false], // 대/소 2종
    ['abcdefghij', false], // 소 1종
    ['1234567890', false], // 숫 1종
    ['!@#$%^&*()', false], // 특 1종
  ])('"%s" → %s', (input, expected) => {
    expect(hasThreeOfFourCharClasses(input)).toBe(expected);
  });
});

const validInput = {
  email: 'User@Example.COM',
  password: 'CorrectHorse!23',
  passwordConfirm: 'CorrectHorse!23',
  name: '홍길동',
  termsAgreed: true,
  privacyAgreed: true,
  ageConfirmed: true,
  marketingAgreed: false,
};

describe('SignupInputSchema', () => {
  it('정상 입력 통과 + 이메일은 소문자 정규화 (BR-AUTH-01)', () => {
    const result = SignupInputSchema.parse(validInput);
    expect(result.email).toBe('user@example.com');
    expect(result.name).toBe('홍길동');
    expect(result.termsAgreed).toBe(true);
    expect(result.privacyAgreed).toBe(true);
    expect(result.ageConfirmed).toBe(true);
    expect(result.marketingAgreed).toBe(false);
  });

  it('marketingAgreed 누락 시 기본 false', () => {
    const { marketingAgreed: _, ...rest } = validInput;
    const result = SignupInputSchema.parse(rest);
    expect(result.marketingAgreed).toBe(false);
  });

  it.each([
    ['email', { email: 'not-an-email' }, /형식/],
    ['email', { email: '' }, /입력/],
    ['password', { password: 'short!1A' }, /10자/], // 짧음
    ['password', { password: 'abcdefghij' }, /3종 이상/], // 1종만
    ['passwordConfirm', { passwordConfirm: 'different!23A' }, /일치/],
    ['name', { name: '   ' }, /이름/],
    ['termsAgreed', { termsAgreed: false }, /이용약관/],
    ['privacyAgreed', { privacyAgreed: false }, /개인정보/],
    ['ageConfirmed', { ageConfirmed: false }, /14세 이상/],
  ])('실패: %s — %p → %s', (_, override, msgPattern) => {
    expect(() => SignupInputSchema.parse({ ...validInput, ...override })).toThrow(msgPattern);
  });

  it('이메일은 trim된다', () => {
    const result = SignupInputSchema.parse({ ...validInput, email: '  user@example.com  ' });
    expect(result.email).toBe('user@example.com');
  });
});

describe('VerifyEmailInputSchema', () => {
  it('64-char hex 토큰 통과', () => {
    const token = 'a'.repeat(64);
    expect(VerifyEmailInputSchema.parse({ token }).token).toBe(token);
  });

  it.each([
    [''],
    ['abc'], // 너무 짧음
    ['g'.repeat(64)], // hex 아님
    ['a'.repeat(63)], // 63자
    ['a'.repeat(65)], // 65자
  ])('실패: %s', (token) => {
    expect(() => VerifyEmailInputSchema.parse({ token })).toThrow();
  });

  it('대소문자 hex 모두 허용 + trim', () => {
    const hex = 'ABCDEFabcdef0123456789' + 'a'.repeat(42); // 22 + 42 = 64 chars
    const token = `  ${hex}  `;
    expect(VerifyEmailInputSchema.parse({ token })).toEqual({ token: hex });
  });
});
