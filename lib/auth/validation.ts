import { z } from 'zod';

// CANDID-010 Step 1 — 회원가입/이메일 인증 zod 스키마.
// BR-AUTH-01: email은 소문자 정규화 후 저장/비교.
// US-AUTH-001 비밀번호 규칙: 최소 10자, 영문 대/소문자/숫자/특수문자 중 3종 이상 조합.
// 약관/개인정보/연령(BR-PII-05 옵션 C) 동의는 literal(true)로 미동의 가입 차단.
// 'use client'/'server-only' 미부착 — 양쪽에서 import 가능 (Edge runtime도 안전).

/** 비밀번호 강도 — 영문 대/소/숫자/특수 4종 중 3종 이상 포함 여부. */
export function hasThreeOfFourCharClasses(password: string): boolean {
  let classes = 0;
  if (/[A-Z]/.test(password)) classes++;
  if (/[a-z]/.test(password)) classes++;
  if (/\d/.test(password)) classes++;
  if (/[^A-Za-z0-9]/.test(password)) classes++;
  return classes >= 3;
}

/** RFC 5322 기본 패턴 — zod의 `email()`이 처리. transform으로 소문자 정규화. */
const EMAIL_FIELD = z
  .string()
  .trim()
  .min(1, '이메일을 입력해 주세요')
  .max(255, '이메일이 너무 깁니다')
  .email('이메일 형식이 올바르지 않습니다')
  .transform((s) => s.toLowerCase());

/** 비밀번호 필드 — 길이 + 3-of-4 강도. */
const PASSWORD_FIELD = z
  .string()
  .min(10, '비밀번호는 최소 10자 이상이어야 합니다')
  .max(72, '비밀번호가 너무 깁니다') // bcrypt 입력 길이 제한
  .refine(hasThreeOfFourCharClasses, {
    message: '비밀번호는 영문 대/소문자·숫자·특수문자 중 3종 이상을 포함해야 합니다',
  });

/** 회원가입 입력 스키마. passwordConfirm은 외부 refine으로 일치 검증. */
export const SignupInputSchema = z
  .object({
    email: EMAIL_FIELD,
    password: PASSWORD_FIELD,
    passwordConfirm: z.string(),
    name: z.string().trim().min(1, '이름을 입력해 주세요').max(100),
    termsAgreed: z.literal(true, {
      errorMap: () => ({ message: '서비스 이용약관에 동의해야 가입할 수 있습니다' }),
    }),
    privacyAgreed: z.literal(true, {
      errorMap: () => ({ message: '개인정보 처리방침에 동의해야 가입할 수 있습니다' }),
    }),
    // BR-PII-05 옵션 C — 가입 시 만 14세 이상 자기 확인. 지원서 시점에 birth_date로 정밀 재검증.
    ageConfirmed: z.literal(true, {
      errorMap: () => ({ message: '만 14세 이상 가입 가능합니다 (이용약관 §X 참조)' }),
    }),
    marketingAgreed: z.boolean().default(false),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: '비밀번호와 비밀번호 확인이 일치하지 않습니다',
    path: ['passwordConfirm'],
  });

export type SignupInput = z.infer<typeof SignupInputSchema>;

/** 이메일 인증 토큰 검증 입력. 토큰은 32 bytes hex(64 char) 형식. */
export const VerifyEmailInputSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, 'token must be 64-char hex'),
});

export type VerifyEmailInput = z.infer<typeof VerifyEmailInputSchema>;
