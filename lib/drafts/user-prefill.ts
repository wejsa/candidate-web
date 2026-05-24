// CANDID-015 Step 2 — User PII lazy prefill (US-APP-002 자동 채움).
//
// db-designer 권고 채택 (lazy prefill — payload 미러 ✗, 응답 별도 prefill 필드):
// - Draft GET 응답에 { payload, prefill } 분리 반환
// - 사용자가 폼에서 수정/저장하면 그때 payload에 stick (payload[field] ?? prefill[field])
// - email은 prefill 전용 (immutable, payload 저장 금지 — User.email 변경 시 일관성 보장)
//
// SECURITY (lib/drafts/types.ts 헤더 정책 참조):
// - 응답 마스킹 정책: prefill은 본인 한정 평문 노출 (BR-PII-01 예외, 폼 prefill 전용)
// - User.phone/birthDate는 piiExtension result wrapper로 자동 복호화 → wrapped prisma 사용 필수
// - 만 14세 교차 검증 (3-layer 중 server-side User 검증)

import 'server-only';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { validateMinAge, MIN_AGE_FOR_APPLICATION } from '@/lib/validation/age';
import type { DraftPrefill } from '@/lib/drafts/types';

/**
 * User의 PII를 복호화하여 Draft 폼 prefill용 평문 string으로 반환한다.
 *
 * - piiExtension result wrapper로 phone/birthDate 자동 복호화 (CANDID-008 자산 재사용)
 * - email은 평문 컬럼이라 그대로 노출
 * - User 미존재 시: throw (호출자가 requireAuth 통과한 후 호출하므로 이론상 발생 안 함)
 *
 * SECURITY: 응답에 평문 PII 포함 — 호출자(route)가 본인 한정 응답 + Cache-Control private 보장 의무.
 */
export async function loadUserPrefill(userId: number): Promise<DraftPrefill> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      phone: true, // wrapped prisma: Uint8Array → string 자동 복호화
      birthDate: true, // wrapped prisma: Uint8Array → string 자동 복호화
    },
  });
  if (user === null) {
    // requireAuth 통과 후 호출되므로 이론상 미발생 — defense-in-depth.
    throw new AppError('USER_NOT_FOUND');
  }
  return {
    email: user.email,
    name: user.name,
    phone: user.phone,
    birthDate: user.birthDate,
  };
}

/**
 * User 원본 birthDate 기준 만 14세 검증 (3-layer 중 server-side cross-check).
 *
 * - User.birthDate가 NULL(소셜 가입자 등)이면 검증 스킵 — Draft 입력 birthDate만 신뢰
 * - User.birthDate가 있으면 만 14세 미만일 시 APP_USER_UNDER_MIN_AGE throw
 *
 * 호출 시점: Draft PUT 본문에 step1_personal이 포함된 경우 (Step 3 폼 통합 후).
 * 본 함수는 Step 2에서 제공되고 Step 3 통합 시 PUT route가 호출하도록 한다.
 */
export async function assertUserMinAge(userId: number, now: Date = new Date()): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { birthDate: true },
  });
  if (user === null) {
    throw new AppError('USER_NOT_FOUND');
  }
  if (user.birthDate === null) {
    // 소셜 가입자 등 — Draft 입력 birthDate만 zod 검증으로 신뢰
    return;
  }
  if (!validateMinAge(user.birthDate, MIN_AGE_FOR_APPLICATION, now)) {
    throw new AppError('APP_USER_UNDER_MIN_AGE');
  }
}
