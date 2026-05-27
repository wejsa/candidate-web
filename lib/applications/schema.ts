// CANDID-018 Step 2 — Application 제출 zod 스키마.
// POST /api/v1/applications body 검증: jobPostingId + consent (제출 직전 별도 동의, US-APP-006).

import { z } from 'zod';

/**
 * 제출 요청 body 스키마.
 * - jobPostingId: 양의 정수 (Draft의 공고 ID와 일치 필수)
 * - consent: true literal — 사용자가 제출 직전 별도 동의 (BR-PII-01 §22 시점 기록의 일부)
 */
export const SubmitRequestSchema = z
  .object({
    jobPostingId: z.coerce.number().int().positive(),
    consent: z.literal(true, {
      errorMap: () => ({ message: '제출 동의가 필요합니다 (consent must be true).' }),
    }),
  })
  .strict();

export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;
