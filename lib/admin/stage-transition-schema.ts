import { z } from 'zod';
import { StageType } from '@prisma/client';

// CANDID-053 Step 6 — 전형 단계 전이 요청 바디. toStage만 수용(.strict — 추가 필드 거부).
export const StageTransitionSchema = z
  .object({
    toStage: z.nativeEnum(StageType),
  })
  .strict();

export type StageTransitionInput = z.infer<typeof StageTransitionSchema>;
