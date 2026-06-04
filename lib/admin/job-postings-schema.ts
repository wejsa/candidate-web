// CANDID-053 Step 4 — 공고 관리 입력 zod 스키마 (route + test 공유, server-only 아님).
import { z } from 'zod';
import { CareerLevel, EmploymentType, JobStatus } from '@prisma/client';

const TITLE = z.string().trim().min(1, '제목을 입력해 주세요').max(200);
const CONTENT = z.string().min(1, '본문을 입력해 주세요'); // 저장 시 sanitizeHtml로 정화
const CATEGORY_ID = z.number().int().positive();
// closesAt: 문자열(datetime) 또는 null(상시 모집). 미전달 시 미변경(update) / null(create).
const CLOSES_AT = z.union([z.string().datetime(), z.null()]);

export const JobPostingCreateSchema = z
  .object({
    title: TITLE,
    jobCategoryId: CATEGORY_ID,
    employmentType: z.nativeEnum(EmploymentType),
    careerLevel: z.nativeEnum(CareerLevel),
    contentHtml: CONTENT,
    opensAt: z.string().datetime(),
    closesAt: CLOSES_AT.optional(),
  })
  .strict()
  .refine(
    (o) => typeof o.closesAt !== 'string' || new Date(o.closesAt) > new Date(o.opensAt),
    { message: '마감일시는 시작일시보다 이후여야 합니다.', path: ['closesAt'] },
  );
export type JobPostingCreateInput = z.infer<typeof JobPostingCreateSchema>;

export const JobPostingUpdateSchema = z
  .object({
    title: TITLE.optional(),
    jobCategoryId: CATEGORY_ID.optional(),
    employmentType: z.nativeEnum(EmploymentType).optional(),
    careerLevel: z.nativeEnum(CareerLevel).optional(),
    contentHtml: CONTENT.optional(),
    opensAt: z.string().datetime().optional(),
    closesAt: CLOSES_AT.optional(),
    status: z.nativeEnum(JobStatus).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: '수정할 항목이 없습니다.' });
export type JobPostingUpdateInput = z.infer<typeof JobPostingUpdateSchema>;
