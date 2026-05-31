// CANDID-024 Step 2 — lib/users/schema.ProfileUpdateSchema 단위 테스트.

import { describe, expect, it } from 'vitest';
import { ProfileUpdateSchema, PasswordChangeSchema } from '@/lib/users/schema';

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

  // QA m1: 연락처 자리수 경계값 분석 (9 하한 / 11 상한 통과, 12 초과 거부).
  it.each([
    ['012345678', true], // 9자리 하한
    ['01234567890', true], // 11자리 상한
    ['012345678901', false], // 12자리 초과
  ])('연락처 %s → success=%s (경계)', (phone, ok) => {
    expect(ProfileUpdateSchema.safeParse({ phone }).success).toBe(ok);
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

describe('PasswordChangeSchema', () => {
  it('현재 + 새(강함) — 통과', () => {
    const r = PasswordChangeSchema.safeParse({
      currentPassword: 'OldPass123!',
      newPassword: 'NewPass456!',
    });
    expect(r.success).toBe(true);
  });

  it('새 비번만(소셜 최초 설정) — 통과 (current optional)', () => {
    const r = PasswordChangeSchema.safeParse({ newPassword: 'NewPass456!' });
    expect(r.success).toBe(true);
  });

  it('약한 새 비번(10자 미만) — 거부', () => {
    const r = PasswordChangeSchema.safeParse({ newPassword: 'Ab1!' });
    expect(r.success).toBe(false);
  });

  it('강도 미달(3-of-4 미충족, 소문자만) — 거부', () => {
    const r = PasswordChangeSchema.safeParse({ newPassword: 'abcdefghijkl' });
    expect(r.success).toBe(false);
  });

  it('새 비번 = 현재 비번 — 거부 (refine)', () => {
    const r = PasswordChangeSchema.safeParse({
      currentPassword: 'SamePass123!',
      newPassword: 'SamePass123!',
    });
    expect(r.success).toBe(false);
  });

  it('여분 키 — strict 거부', () => {
    const r = PasswordChangeSchema.safeParse({ newPassword: 'NewPass456!', admin: true });
    expect(r.success).toBe(false);
  });
});
