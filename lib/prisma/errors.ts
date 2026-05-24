import 'server-only';
import { Prisma } from '@prisma/client';

// CANDID-037 Step 1 — Prisma error 식별 cross-cutting helper.
//
// 배경 (L-025, db-designer 분석):
// `PrismaClientKnownRequestError`의 `code === 'P2002'`는 UNIQUE 제약 위반이지만,
// **어떤 UNIQUE 인덱스**가 충돌했는지에 따라 비즈니스 의미가 다르다.
// - `uk_email_verifications_active_per_user` (부분 UNIQUE) → race-cooldown 시맨틱
// - `email_verifications_token_hash_key` (sha256 충돌) → 사실상 시스템 에러
// `code === 'P2002'`만 보고 매핑하면 token_hash 충돌까지 cooldown으로 잘못 분류된다.
//
// 본 모듈은 `meta.target` 화이트리스트 검증을 강제하여 정밀 매핑을 가능하게 한다.
// 향후 signup/application 등 다른 P2002 분기에서도 재사용.

/**
 * 임의 객체가 Prisma의 `PrismaClientKnownRequestError`인지 식별한다.
 *
 * `instanceof` 만으로는 Prisma 패키지가 여러 번 번들링/모킹된 환경(테스트, multi-package)에서
 * false negative가 발생할 수 있다. duck-typing 폴백을 결합한다 (constructor name + code 속성).
 */
export function isPrismaKnownError(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return true;
  if (err === null || typeof err !== 'object') return false;
  const ctorName = (err as { constructor?: { name?: string } }).constructor?.name;
  if (ctorName !== 'PrismaClientKnownRequestError') return false;
  // Prisma known error는 code 문자열을 항상 가진다 (P1xxx/P2xxx).
  return typeof (err as { code?: unknown }).code === 'string';
}

/**
 * `err.meta.target`을 normalize한 문자열 배열로 반환한다.
 *
 * Prisma는 인덱스명 / 컬럼명 / 컬럼명 배열 등 다양한 형태로 `meta.target`을 제공할 수 있다.
 * - 문자열: 단일 인덱스명 또는 컬럼명 → `[value]`
 * - 배열: 컬럼명들 → 그대로
 * - 부재 / 기타 타입 → `null`
 *
 * `isUniqueViolationOn`이 내부적으로 사용하며, 로그/디버깅 용으로도 export.
 */
export function getUniqueViolationTarget(err: unknown): string[] | null {
  if (!isPrismaKnownError(err)) return null;
  if (err.code !== 'P2002') return null;
  const target = err.meta?.target;
  if (target === undefined || target === null) return null;
  if (Array.isArray(target)) {
    return target.every((v) => typeof v === 'string') ? (target as string[]) : null;
  }
  if (typeof target === 'string') return [target];
  return null;
}

/**
 * P2002 UNIQUE 위반이 *허용된 인덱스/컬럼 집합* 중 하나인지 검증한다.
 *
 * 사용 패턴:
 * ```typescript
 * try {
 *   await prisma.emailVerification.create({ ... });
 * } catch (err) {
 *   if (isUniqueViolationOn(err, ['uk_email_verifications_active_per_user'])) {
 *     throw new AppError('AUTH_VERIFICATION_RESEND_COOLDOWN');
 *   }
 *   throw err; // token_hash UNIQUE는 시스템 에러로 전파
 * }
 * ```
 *
 * 화이트리스트 매칭은 *부분집합* 조건: `meta.target`이 전부 `allowedTargets`에 포함될 때만 true.
 * 하나라도 허용 외 항목이 있으면 false (보수적) → 모르는 인덱스 충돌은 전파.
 */
export function isUniqueViolationOn(
  err: unknown,
  allowedTargets: readonly string[],
): boolean {
  const target = getUniqueViolationTarget(err);
  if (target === null || target.length === 0) return false;
  const allowed = new Set(allowedTargets);
  return target.every((t) => allowed.has(t));
}
