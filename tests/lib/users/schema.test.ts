// CANDID-024 Step 2 — lib/users/schema.ProfileUpdateSchema 단위 테스트.

import { describe, expect, it } from 'vitest';
import { ProfileUpdateSchema } from '@/lib/users/schema';

describe('ProfileUpdateSchema', () => {
  it('이름만 — 통과', () => {
    const r = ProfileUpdateSchema.safeParse({ name: '김지원' });
    expect(r.success).toBe(true);
  });

  it('연락처만(하이픈 허용) — 통과', () => {
    const r = ProfileUpdateSchema.safeParse({ phone: '010-1234-5678' });
    expect(r.success).toBe(true);
  });

  it('이름 + 연락처 — 통과', () => {
    const r = ProfileUpdateSchema.safeParse({ name: '김지원', phone: '01012345678' });
    expect(r.success).toBe(true);
  });

  it('phone=null(연락처 삭제) — 통과', () => {
    const r = ProfileUpdateSchema.safeParse({ phone: null });
    expect(r.success).toBe(true);
  });

  it('빈 객체 — 거부 (최소 1개 필드)', () => {
    const r = ProfileUpdateSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('잘못된 연락처(8자리) — 거부', () => {
    const r = ProfileUpdateSchema.safeParse({ phone: '12345678' });
    expect(r.success).toBe(false);
  });

  it('이름 공백만 — 거부 (trim 후 min 1)', () => {
    const r = ProfileUpdateSchema.safeParse({ name: '   ' });
    expect(r.success).toBe(false);
  });

  it('이름 100자 초과 — 거부', () => {
    const r = ProfileUpdateSchema.safeParse({ name: 'a'.repeat(101) });
    expect(r.success).toBe(false);
  });

  it('여분 키 — strict 거부', () => {
    const r = ProfileUpdateSchema.safeParse({ name: '김', role: 'admin' });
    expect(r.success).toBe(false);
  });
});
