// CANDID-018 Step 1 — IdempotencyKeySchema 단위 테스트 (T-H001 fix, PR #67 review).
// UUID v4 정규식 회귀 가드 — 정규식 수정 시 무성 회귀 차단.

import { describe, expect, it } from 'vitest';
import { IdempotencyKeySchema } from '@/lib/idempotency/schema';

describe('IdempotencyKeySchema', () => {
  it('유효 UUID v4 (lowercase) → 통과', () => {
    expect(() => IdempotencyKeySchema.parse('11111111-2222-4333-8444-555555555555')).not.toThrow();
    expect(() => IdempotencyKeySchema.parse('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).not.toThrow();
  });

  it('유효 UUID v4 (uppercase, /i 플래그) → 통과', () => {
    expect(() =>
      IdempotencyKeySchema.parse('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'),
    ).not.toThrow();
  });

  it.each([
    ['nil UUID (v0)', '00000000-0000-0000-0000-000000000000'],
    ['v1 UUID (version=1)', '11111111-2222-1333-8444-555555555555'],
    ['v5 UUID (version=5)', '11111111-2222-5333-8444-555555555555'],
    ['잘못된 variant (7로 시작)', '11111111-2222-4333-7444-555555555555'],
    ['잘못된 variant (c로 시작)', '11111111-2222-4333-c444-555555555555'],
    ['길이 35자', '11111111-2222-4333-8444-55555555555'],
    ['길이 37자', '11111111-2222-4333-8444-5555555555555'],
    ['하이픈 위치 오류', '111111112-222-4333-8444-55555555555'],
    ['하이픈 없음', '11111111222243338444555555555555'],
    ['빈 문자열', ''],
    ['16진수 외 문자', '11111111-2222-4333-8444-55555555555G'],
  ])('거부: %s', (_label, value) => {
    expect(() => IdempotencyKeySchema.parse(value)).toThrow();
  });
});
