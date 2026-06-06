// CANDID-053 Step 5 — 운영자 지원자 목록 쿼리 파서 단위 테스트.
import { describe, expect, it } from 'vitest';
import { parseApplicantListQuery } from '@/lib/admin/applicants-schema';

const sp = (q: string) => new URLSearchParams(q);

describe('parseApplicantListQuery', () => {
  it('미지정 → page=1, stage undefined', () => {
    const r = parseApplicantListQuery(sp(''));
    expect(r.page).toBe(1);
    expect(r.stage).toBeUndefined();
  });

  it('page 문자열 → 숫자 강제', () => {
    expect(parseApplicantListQuery(sp('page=3')).page).toBe(3);
  });

  it('빈 문자열 stage → undefined로 정규화(미필터)', () => {
    expect(parseApplicantListQuery(sp('stage=')).stage).toBeUndefined();
  });

  it('유효 stage → 통과', () => {
    expect(parseApplicantListQuery(sp('stage=OFFER')).stage).toBe('OFFER');
  });

  it('무효 stage enum → throw', () => {
    expect(() => parseApplicantListQuery(sp('stage=BOGUS'))).toThrow();
  });

  it('page 0/음수/비숫자 → throw (positive 위반)', () => {
    expect(() => parseApplicantListQuery(sp('page=0'))).toThrow();
    expect(() => parseApplicantListQuery(sp('page=-1'))).toThrow();
    expect(() => parseApplicantListQuery(sp('page=abc'))).toThrow();
  });

  it('page 상한(10000) 초과 → throw (deep-offset 방어)', () => {
    expect(() => parseApplicantListQuery(sp('page=10001'))).toThrow();
    expect(parseApplicantListQuery(sp('page=10000')).page).toBe(10_000);
  });
});
