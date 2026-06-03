// CANDID-022 Step 2 — 회원 탈퇴 zod 입력 스키마.
//
// Route Handler가 request body → 본 스키마.parse로 검증한 결과를 withdrawUser에 전달.
// passwordConfirmation은 본인 인증 단계에서 검증되므로 zod는 형식(길이)만 강제 — 비밀번호 정책 자체는
// password.ts(BR-AUTH-02 BCrypt strength 12) 책임.

import { z } from 'zod';
import { hasThreeOfFourCharClasses } from '@/lib/auth/validation';

export const WithdrawInputSchema = z
  .object({
    /**
     * 비밀번호 재확인 — 비밀번호 보유 사용자만 사용. 1~256자 (BCrypt 입력 한도 72 bytes는 hashPassword가 검증).
     * 미전달 + passwordHash NOT NULL → withdrawUser가 USER_PASSWORD_RECONFIRM_REQUIRED throw.
     */
    passwordConfirmation: z.string().min(1).max(256).optional(),
    /** 탈퇴 사유 (선택, 사용자 자유 입력) — trim 후 최대 500자. AuditLog는 길이만 기록 (BR-PII-02 평문 미보존). */
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type WithdrawInputBody = z.infer<typeof WithdrawInputSchema>;

// === CANDID-024 Step 2 — 프로필 수정 (이름/연락처) 입력 스키마 (US-MY-004) ============
//
// 형식 검증만 담당 — phone 정규화/암호화는 lib/prisma/extends.ts encryptUserPiiInput(normalizePhone) 책임.
// 부분 갱신(PATCH): name/phone 모두 optional, 단 최소 1개는 있어야 한다. phone=null은 "연락처 삭제".

const PROFILE_NAME_FIELD = z.string().trim().min(1, '이름을 입력해 주세요').max(100);

/** 연락처 — 하이픈/공백 허용, 숫자만 추출 시 9~11자리 (normalizePhone과 동일 기준). */
const PROFILE_PHONE_FIELD = z
  .string()
  .trim()
  .refine((s) => {
    const digits = s.replace(/[^0-9]/g, '');
    return digits.length >= 9 && digits.length <= 11;
  }, '연락처는 9~11자리 숫자여야 합니다.');

/** 생년월일 — YYYY-MM-DD (normalizeBirthDate와 동일 기준). 자동 채움(지원서 prefill)에 사용. */
const PROFILE_BIRTHDATE_FIELD = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '생년월일은 YYYY-MM-DD 형식이어야 합니다.');

export const ProfileUpdateSchema = z
  .object({
    name: PROFILE_NAME_FIELD.optional(),
    /** 신규 연락처 문자열 또는 null(삭제). 미전달 시 연락처 미변경. */
    phone: z.union([PROFILE_PHONE_FIELD, z.null()]).optional(),
    /** 생년월일 문자열(YYYY-MM-DD) 또는 null(삭제). 미전달 시 미변경. */
    birthDate: z.union([PROFILE_BIRTHDATE_FIELD, z.null()]).optional(),
  })
  .strict()
  .refine((o) => o.name !== undefined || 'phone' in o || 'birthDate' in o, {
    message: '수정할 항목이 없습니다.',
  });

export type ProfileUpdateBody = z.infer<typeof ProfileUpdateSchema>;

// === CANDID-024 Step 3 — 비밀번호 변경 입력 스키마 (US-MY-004) =======================
//
// newPassword는 회원가입과 동일 강도(최소 10자 + UTF-8 72바이트 + 3-of-4). 강도 규칙 SSOT는
// lib/auth/validation.ts의 hasThreeOfFourCharClasses 재사용. currentPassword는 비번 보유 사용자
// 재확인용(소셜 전용 최초 설정 시 생략 가능) — 일치 검증은 changePassword(verifyPassword) 책임.

const NEW_PASSWORD_FIELD = z
  .string()
  .min(10, '비밀번호는 최소 10자 이상이어야 합니다')
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, {
    message: '비밀번호가 너무 깁니다 (UTF-8 72바이트 이내, 한글은 24자)',
  })
  .refine(hasThreeOfFourCharClasses, {
    message: '비밀번호는 영문 대/소문자·숫자·특수문자 중 3종 이상을 포함해야 합니다',
  });

export const PasswordChangeSchema = z
  .object({
    /** 현재 비밀번호(보유 사용자 재확인). 소셜 전용 계정 최초 설정 시 생략. */
    currentPassword: z.string().min(1).max(256).optional(),
    newPassword: NEW_PASSWORD_FIELD,
  })
  .strict()
  .refine((o) => o.currentPassword !== o.newPassword, {
    message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.',
    path: ['newPassword'],
  });

export type PasswordChangeBody = z.infer<typeof PasswordChangeSchema>;
