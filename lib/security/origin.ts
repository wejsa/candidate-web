import 'server-only';
import type { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';
import { resolveAllowedOrigin } from '@/lib/security/cors';

// CANDID-009 Step 2 — CSRF Origin 검증.
// BR-SEC-02 "SameSite cookie + Origin 검증" — state-changing methods 한정.
// SameSite=Lax는 CANDID-006 cookies.ts에서 이미 적용 — Origin 검증으로 보강 (이중 방어).
// GET/HEAD/OPTIONS는 idempotent로 가정하고 스킵 — OPTIONS는 middleware preflight에서 종결.

/** state-changing methods — body를 가질 수 있고 부수효과 일으키는 HTTP 메서드. */
const STATE_CHANGING_METHODS: ReadonlySet<string> = Object.freeze(
  new Set(['POST', 'PUT', 'PATCH', 'DELETE']),
);

/** 메서드가 CSRF 검증 대상인지 판정. 대소문자 정규화 후 비교. */
export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

/**
 * state-changing 요청의 Origin 헤더가 화이트리스트에 속하는지 검증한다.
 * 검증 실패 시 AppError('SYS_FORBIDDEN_ORIGIN')을 throw — withErrorHandler가 표준 403 응답으로 변환.
 *
 * - GET/HEAD/OPTIONS: 무조건 통과 (CSRF 비대상)
 * - Origin 헤더 부재: SameSite=Lax 쿠키와 결합한 환경에서는 동일 출처 또는 top-level 네비게이션
 *   요청을 의미하므로 통과 (브라우저는 cross-site POST에 Origin을 항상 부착)
 * - Origin 헤더 존재 + 화이트리스트 미일치: 차단
 */
export function assertAllowedOrigin(request: NextRequest): void {
  if (!isStateChangingMethod(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin === null || origin === '') return; // SameSite=Lax + Origin 부재 = 동일 출처
  if (resolveAllowedOrigin(origin) === null) {
    throw new AppError('SYS_FORBIDDEN_ORIGIN', {
      details: [{ field: 'origin', reason: `Origin "${origin}" is not in CORS whitelist` }],
    });
  }
}
