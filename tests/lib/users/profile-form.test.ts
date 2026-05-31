// CANDID-024 Step 2 — lib/users/profile-form 순수 헬퍼 단위 테스트.

import { describe, expect, it } from 'vitest';
import {
  PROFILE_EDIT_LABELS as L,
  PASSWORD_CHANGE_LABELS as PL,
  SOCIAL_ACCOUNTS_LABELS as SL,
  buildProfileUpdatePayload,
  isEmptyPayload,
  classifyProfileUpdateError,
  classifyPasswordChangeError,
  classifyUnlinkError,
} from '@/lib/users/profile-form';

describe('buildProfileUpdatePayload', () => {
  it('이름 변경 시에만 name 포함', () => {
    const p = buildProfileUpdatePayload({ name: '새이름', phone: '' }, { name: '옛이름' });
    expect(p).toEqual({ name: '새이름' });
  });

  it('이름이 원본과 같으면 name 제외', () => {
    const p = buildProfileUpdatePayload({ name: '같음', phone: '' }, { name: '같음' });
    expect(p.name).toBeUndefined();
    expect(isEmptyPayload(p)).toBe(true);
  });

  it('이름 trim 후 원본과 같으면 제외', () => {
    const p = buildProfileUpdatePayload({ name: '  같음  ', phone: '' }, { name: '같음' });
    expect(p.name).toBeUndefined();
  });

  it('연락처 입력 시 phone 포함 (trim)', () => {
    const p = buildProfileUpdatePayload(
      { name: '같음', phone: ' 010-1234-5678 ' },
      { name: '같음' },
    );
    expect(p).toEqual({ phone: '010-1234-5678' });
  });

  it('이름 + 연락처 동시 변경', () => {
    const p = buildProfileUpdatePayload({ name: '새', phone: '01011112222' }, { name: '옛' });
    expect(p).toEqual({ name: '새', phone: '01011112222' });
  });

  it('변경 없음 → 빈 페이로드', () => {
    const p = buildProfileUpdatePayload({ name: '같음', phone: '   ' }, { name: '같음' });
    expect(isEmptyPayload(p)).toBe(true);
  });
});

describe('classifyProfileUpdateError', () => {
  it.each([
    [400, L.errorInvalid],
    [422, L.errorInvalid],
    [429, L.errorRateLimited],
    [401, L.errorSession],
    [404, L.errorSession],
    [500, L.errorGeneric],
  ])('status %i → 메시지', (status, expected) => {
    expect(classifyProfileUpdateError(status)).toBe(expected);
  });
});

describe('classifyPasswordChangeError', () => {
  it.each([
    [401, PL.errorCurrentInvalid],
    [400, PL.errorWeak],
    [422, PL.errorCurrentInvalid],
    [429, PL.errorRateLimited],
    [404, PL.errorSession],
    [500, PL.errorGeneric],
  ])('status %i → 메시지', (status, expected) => {
    expect(classifyPasswordChangeError(status)).toBe(expected);
  });
});

describe('classifyUnlinkError', () => {
  it.each([
    [409, SL.errorLastAuth],
    [404, SL.errorNotLinked],
    [401, SL.errorSession],
    [500, SL.errorGeneric],
  ])('status %i → 메시지', (status, expected) => {
    expect(classifyUnlinkError(status)).toBe(expected);
  });
});
