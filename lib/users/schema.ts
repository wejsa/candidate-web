// CANDID-022 Step 2 — 회원 탈퇴 zod 입력 스키마.
//
// Route Handler가 request body → 본 스키마.parse로 검증한 결과를 withdrawUser에 전달.
// passwordConfirmation은 본인 인증 단계에서 검증되므로 zod는 형식(길이)만 강제 — 비밀번호 정책 자체는
// password.ts(BR-AUTH-02 BCrypt strength 12) 책임.

import { z } from 'zod';

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
