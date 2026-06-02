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

/**
 * CANDID-023 Step 3 — 지원 철회 요청 body 스키마 (US-MY-003).
 * - reason: 철회 사유 (선택). trim 후 최대 500자 (DB withdraw_reason VarChar(500)와 정합).
 *   평문으로 저장·표시되며 출력 측은 React 텍스트 렌더로 escape (L-006 이중 방어).
 * - `.strict()`로 여분 키 거부. 빈 body({})도 허용 — 사유 미입력 철회.
 */
export const WithdrawRequestSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type WithdrawRequest = z.infer<typeof WithdrawRequestSchema>;
