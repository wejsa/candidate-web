// CANDID-015 Step 1 — Draft zod schemas (US-APP-002 필드 검증).
// Draft PUT 시점 + 클라이언트 폼 양쪽 공유 (server-only 마킹 ✗ — Prisma 의존 없음).

import { z } from 'zod';
import { validateMinAge, MIN_AGE_FOR_APPLICATION } from '@/lib/validation/age';

const NAME_REGEX = /^[가-힣A-Za-z\s'-]{2,50}$/; // 한글/영문 + 공백/하이픈/어포스트로피
const PHONE_REGEX = /^010-\d{4}-\d{4}$/;
const BIRTH_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const CAREER_LEVELS = ['NEW', 'EXPERIENCED'] as const;
export const EDUCATION_LEVELS = [
  'HIGH_SCHOOL',
  'ASSOCIATE',
  'BACHELOR',
  'MASTER',
  'DOCTORATE',
] as const;
export const APPLICATION_STEPS = [1, 2, 3] as const;

export const PersonalInfoSchema = z
  .object({
    name: z.string().regex(NAME_REGEX, '이름은 한글/영문 2~50자여야 합니다.'),
    phone: z.string().regex(PHONE_REGEX, '연락처 형식이 올바르지 않습니다 (010-XXXX-XXXX).'),
    birthDate: z
      .string()
      .regex(BIRTH_DATE_REGEX, '생년월일은 YYYY-MM-DD 형식이어야 합니다.')
      .refine(
        (v) => validateMinAge(v, MIN_AGE_FOR_APPLICATION),
        `만 ${MIN_AGE_FOR_APPLICATION}세 미만은 지원할 수 없습니다.`,
      ),
    address: z.string().max(200).optional(),
    careerLevel: z.enum(CAREER_LEVELS),
    careerMonths: z.number().int().nonnegative().max(720).optional(),
    education: z.enum(EDUCATION_LEVELS).optional(),
  })
  .superRefine((data, ctx) => {
    // EXPERIENCED는 careerMonths 필수 (US-APP-002)
    if (data.careerLevel === 'EXPERIENCED' && data.careerMonths === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['careerMonths'],
        message: '경력자는 총 경력 개월 수를 입력해야 합니다.',
      });
    }
  });

export const DraftMetaSchema = z.object({
  currentStep: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  completedSteps: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).max(3),
  lastClientSavedAt: z.string().datetime().optional(),
});

export const DraftPayloadV1Schema = z.object({
  schemaVersion: z.literal(1),
  meta: DraftMetaSchema,
  step1_personal: PersonalInfoSchema.optional(),
  // step2/step3는 향후 확장 — 임의 JSON 통과 허용 (검증은 해당 step task에서 추가)
  step2_attachments: z.record(z.string(), z.unknown()).optional(),
  step3_answers: z.record(z.string(), z.unknown()).optional(),
});

export const DraftPutRequestSchema = z.object({
  payload: DraftPayloadV1Schema,
  version: z.number().int().nonnegative(),
});

export const JobPostingIdParamSchema = z.object({
  jobPostingId: z.coerce.number().int().positive().max(2_147_483_647),
});

/** 신규 Draft의 초기 payload — payload.meta.currentStep=1, completedSteps=[]. */
export function initialPayload(): z.infer<typeof DraftPayloadV1Schema> {
  return {
    schemaVersion: 1,
    meta: { currentStep: 1, completedSteps: [] },
  };
}
