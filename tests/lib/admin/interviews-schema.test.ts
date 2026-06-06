import { describe, expect, it } from 'vitest';
import { InterviewUpsertSchema } from '@/lib/admin/interviews-schema';

// CANDID-053 Step 7 — 면접 일정 요청 스키마 경계 검증.
const base = {
  stage: 'INTERVIEW_1',
  scheduledAt: '2026-07-01T05:00:00.000Z',
  locationOrUrl: 'https://meet.example.com/a',
};
const ok = (o: Record<string, unknown>) =>
  InterviewUpsertSchema.safeParse({ ...base, ...o }).success;

describe('InterviewUpsertSchema', () => {
  it('INTERVIEW_1/INTERVIEW_2만 허용, 그 외 단계 거부', () => {
    expect(ok({ stage: 'INTERVIEW_2' })).toBe(true);
    expect(ok({ stage: 'SUBMITTED' })).toBe(false);
    expect(ok({ stage: 'OFFER' })).toBe(false);
  });

  it('locationOrUrl 경계: 빈 문자열 거부, 500자 허용/501자 거부', () => {
    expect(ok({ locationOrUrl: '' })).toBe(false);
    expect(ok({ locationOrUrl: 'a'.repeat(500) })).toBe(true);
    expect(ok({ locationOrUrl: 'a'.repeat(501) })).toBe(false);
  });

  it('scheduledAt: ISO 8601만 허용(과거/미래 모두). 비-ISO 거부', () => {
    expect(ok({ scheduledAt: '2020-01-01T00:00:00.000Z' })).toBe(true); // 과거 허용(재조정)
    expect(ok({ scheduledAt: 'not-a-date' })).toBe(false);
    expect(ok({ scheduledAt: '2026-07-01' })).toBe(false); // date-only 거부
  });

  it('.strict — 추가 필드 거부', () => {
    expect(ok({ status: 'DONE' })).toBe(false);
    expect(ok({ applicationId: 1 })).toBe(false);
  });
});
