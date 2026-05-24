import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  getUniqueViolationTarget,
  isPrismaKnownError,
  isUniqueViolationOn,
} from '@/lib/prisma/errors';

// CANDID-037 Step 1 — lib/prisma/errors helper 단위 테스트.
// 핵심 회귀 가드:
//   1) duck-typing 단독 회피 — `code: 'P2002'` 평범 객체는 false (signup.ts L-step3 보강 패턴)
//   2) meta.target 다양 형태(string | string[] | undefined) 모두 안전 처리
//   3) 화이트리스트는 *부분집합* 매칭 — 모르는 항목 포함 시 false (보수적 전파)

/**
 * Prisma `PrismaClientKnownRequestError` 인스턴스 생성 헬퍼.
 * Prisma 6 시그니처: new PrismaClientKnownRequestError(message, { code, clientVersion, meta }).
 */
function makeKnownError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code,
    clientVersion: 'test',
    meta,
  });
}

describe('isPrismaKnownError', () => {
  it('Prisma instance → true (instanceof)', () => {
    const err = makeKnownError('P2002', { target: ['user_id'] });
    expect(isPrismaKnownError(err)).toBe(true);
  });

  it('null / undefined → false', () => {
    expect(isPrismaKnownError(null)).toBe(false);
    expect(isPrismaKnownError(undefined)).toBe(false);
  });

  it('일반 Error → false (constructor name 불일치)', () => {
    expect(isPrismaKnownError(new Error('boom'))).toBe(false);
  });

  it('duck-typing 회피 — 평범 객체에 code:P2002 있어도 false', () => {
    // signup.ts L-step3 패턴 회귀 가드: 임의 객체를 Prisma error로 오인 금지.
    expect(isPrismaKnownError({ code: 'P2002', meta: { target: ['x'] } })).toBe(false);
  });

  it('duck-typing 폴백 — constructor name 일치 + code string → true', () => {
    // Prisma 패키지가 multi-bundle/mock된 환경에서 instanceof false negative 폴백.
    class PrismaClientKnownRequestError extends Error {
      readonly code: string;
      constructor(code: string) {
        super('mocked');
        this.code = code;
      }
    }
    const mocked = new PrismaClientKnownRequestError('P2002');
    expect(isPrismaKnownError(mocked)).toBe(true);
  });

  it('duck-typing 폴백 — constructor name 일치하나 code 부재 → false', () => {
    class PrismaClientKnownRequestError {
      // intentionally no code
    }
    expect(isPrismaKnownError(new PrismaClientKnownRequestError())).toBe(false);
  });
});

describe('getUniqueViolationTarget', () => {
  it('P2002 + meta.target 배열 → 그대로 반환', () => {
    const err = makeKnownError('P2002', { target: ['user_id', 'job_posting_id'] });
    expect(getUniqueViolationTarget(err)).toEqual(['user_id', 'job_posting_id']);
  });

  it('P2002 + meta.target 단일 문자열(인덱스명) → 배열로 wrap', () => {
    const err = makeKnownError('P2002', {
      target: 'uk_email_verifications_active_per_user',
    });
    expect(getUniqueViolationTarget(err)).toEqual([
      'uk_email_verifications_active_per_user',
    ]);
  });

  it('P2002 + meta.target 부재 → null', () => {
    const err = makeKnownError('P2002');
    expect(getUniqueViolationTarget(err)).toBeNull();
  });

  it('P2002 + meta.target null → null', () => {
    const err = makeKnownError('P2002', { target: null });
    expect(getUniqueViolationTarget(err)).toBeNull();
  });

  it('P2025(record not found) 같은 다른 코드 → null', () => {
    const err = makeKnownError('P2025', { target: ['user_id'] });
    expect(getUniqueViolationTarget(err)).toBeNull();
  });

  it('non-Prisma error → null', () => {
    expect(getUniqueViolationTarget(new Error('boom'))).toBeNull();
    expect(getUniqueViolationTarget({ code: 'P2002', meta: { target: ['x'] } })).toBeNull();
  });

  it('meta.target 배열에 non-string 혼합 → null (안전 거부)', () => {
    const err = makeKnownError('P2002', { target: ['user_id', 123, null] });
    expect(getUniqueViolationTarget(err)).toBeNull();
  });
});

describe('isUniqueViolationOn — 화이트리스트 매칭', () => {
  it('단일 인덱스명 일치 → true (race-cooldown 시맨틱)', () => {
    const err = makeKnownError('P2002', {
      target: 'uk_email_verifications_active_per_user',
    });
    expect(
      isUniqueViolationOn(err, ['uk_email_verifications_active_per_user']),
    ).toBe(true);
  });

  it('컬럼명 배열 일치 → true', () => {
    const err = makeKnownError('P2002', { target: ['user_id'] });
    expect(isUniqueViolationOn(err, ['user_id', 'uk_email_verifications_active_per_user'])).toBe(
      true,
    );
  });

  it('token_hash UNIQUE → 화이트리스트 외 → false (sha256 충돌은 시스템 에러로 전파)', () => {
    // CANDID-037 핵심 정밀화: email_verifications_token_hash_key 충돌은
    // cooldown 시맨틱이 아니라 SYS_INTERNAL_ERROR 전파해야 한다.
    const err = makeKnownError('P2002', { target: ['token_hash'] });
    expect(
      isUniqueViolationOn(err, ['uk_email_verifications_active_per_user']),
    ).toBe(false);
  });

  it('부분집합 — 일부 컬럼이 화이트리스트 외 → false (보수적 거부)', () => {
    const err = makeKnownError('P2002', { target: ['user_id', 'unknown_field'] });
    expect(isUniqueViolationOn(err, ['user_id'])).toBe(false);
  });

  it('meta.target 부재 → false (정보 없으면 매핑 거부)', () => {
    const err = makeKnownError('P2002');
    expect(isUniqueViolationOn(err, ['user_id'])).toBe(false);
  });

  it('non-P2002 → false', () => {
    const err = makeKnownError('P2025', { target: ['user_id'] });
    expect(isUniqueViolationOn(err, ['user_id'])).toBe(false);
  });

  it('non-Prisma error → false', () => {
    expect(isUniqueViolationOn(new Error('boom'), ['user_id'])).toBe(false);
    expect(isUniqueViolationOn({ code: 'P2002', meta: { target: 'user_id' } }, ['user_id'])).toBe(
      false,
    );
  });

  it('빈 화이트리스트 → 항상 false', () => {
    const err = makeKnownError('P2002', { target: ['user_id'] });
    expect(isUniqueViolationOn(err, [])).toBe(false);
  });
});
