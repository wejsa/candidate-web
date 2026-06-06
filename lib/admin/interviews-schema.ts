import { z } from 'zod';
// CANDID-053 Step 12 — 면접 단계 SSOT를 공용 모듈로 분리(클라 InterviewScheduleForm와 드리프트 차단).
import { INTERVIEW_STAGES } from '@/lib/admin/interview-stages';

// CANDID-053 Step 7 — 면접 일정 생성/변경 요청 바디.
// 면접은 면접 단계(INTERVIEW_1/INTERVIEW_2)에 대해서만 등록. .strict로 추가 필드 거부.

export const InterviewUpsertSchema = z
  .object({
    stage: z.enum(INTERVIEW_STAGES),
    // ISO 8601 일시. 과거/미래 모두 허용(재조정·기록 목적).
    scheduledAt: z.string().datetime({ message: 'scheduledAt must be ISO 8601 datetime' }),
    // 오프라인 주소 또는 화상 링크(평문, ≤500). 후보 표시 시 React 이스케이프로 XSS 방어.
    locationOrUrl: z.string().min(1).max(500),
  })
  .strict();

export type InterviewUpsertInput = z.infer<typeof InterviewUpsertSchema>;
