// CANDID-022 Step 4 — WITHDRAW_LABELS SSOT 회귀 가드 단위 테스트.

import { describe, expect, it } from 'vitest';
import { WITHDRAW_LABELS, type WithdrawLabelKey } from '@/lib/users/labels';

describe('WITHDRAW_LABELS — SSOT 정합성', () => {
  it('객체는 Object.freeze로 동결됨 (mutation 차단)', () => {
    expect(Object.isFrozen(WITHDRAW_LABELS)).toBe(true);
  });

  it('모든 라벨은 비어있지 않은 문자열', () => {
    const keys = Object.keys(WITHDRAW_LABELS) as WithdrawLabelKey[];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const value = WITHDRAW_LABELS[key];
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('BR-PII-02 회귀 가드 — 라벨에 PII 단서 미포함', () => {
    // 사용자 노출 라벨이라 의도된 한국어 문구 외에 이메일/전화번호/주민번호 형식 미포함.
    const allText = Object.values(WITHDRAW_LABELS).join(' ');
    expect(allText).not.toMatch(/\d{3}-?\d{4}-?\d{4}/); // 휴대폰 형식
    expect(allText).not.toMatch(/\d{6}-[1-4]\d{6}/); // 주민번호 형식
    expect(allText).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/); // 이메일 형식
  });

  it('핵심 분기 안내 키 존재 (UI 회귀 가드)', () => {
    // page.tsx + Form + Modal 3 위치에서 참조되는 키가 SSOT에 빠짐없이 있는지 검증.
    const requiredKeys: WithdrawLabelKey[] = [
      'pageTitle',
      'pageDescription',
      'noticeAnonymizedBranch',
      'noticeHardDeleteBranch',
      'noticeIrreversible',
      'noticeRefreshTokenRevoke',
      'passwordFieldLabel',
      'socialOnlyNotice',
      'reasonFieldLabel',
      'submitButton',
      'cancelButton',
      'modalHeading',
      'modalConfirmButton',
      'modalCancelButton',
      'errorPasswordMismatch',
      'errorPasswordRequired',
      'errorAlreadyWithdrawn',
      'errorRateLimited',
      'errorGeneric',
    ];
    for (const key of requiredKeys) {
      expect(WITHDRAW_LABELS).toHaveProperty(key);
    }
  });
});
