import 'server-only';
import { getEnv } from '@/lib/env';

// CANDID-012 Step 3 review fix (C001 + S-MAJOR-4.1/4.2) — redirect sanitize SSOT.
//
// Open-redirect 방어 패턴:
//   1) start route — 입력 즉시 sanitize → state cookie payload에 저장
//   2) callback route — state.redirect 복원 후 **재sanitize + origin 검증** (defense-in-depth)
//
// WHATWG URL spec이 tab/CR/LF를 path 파싱 전 strip하는 이유로 일부 브라우저가
// `/\t//evil.com`을 `//evil.com`(protocol-relative)으로 재해석 → 외부 도메인 redirect 가능.
// 본 헬퍼는 그러한 화이트스페이스/제어문자를 사전에 거부한다.

/** start/callback 양쪽이 호출하는 사전 입력 sanitize. 비정상 입력은 모두 `/`로 fallback. */
export function sanitizeOAuthRedirect(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw === '') return '/';
  // 제어문자(0x00-0x1F, 0x7F) + tab/CR/LF — 브라우저 URL parsing 비대칭 우회 차단.
  if (/[\x00-\x1F\x7F]/.test(raw)) return '/';
  if (!raw.startsWith('/')) return '/';
  // protocol-relative 차단: `//evil.com`
  if (raw.startsWith('//')) return '/';
  // backslash로 path 우회 차단: `/\\evil.com` (일부 브라우저가 backslash를 forward slash로 정규화)
  if (raw.startsWith('/\\')) return '/';
  if (raw.length > 2048) return '/';
  return raw;
}

/**
 * callback에서 호출 — state.redirect 복원 후 절대 URL 구성 + origin 검증.
 *
 * 1차 방어: state cookie HMAC 서명으로 변조 차단
 * 2차 방어(본 함수): start route의 sanitize가 변경되거나 미래에 회귀해도 callback이 자체 차단
 * 3차 방어(본 함수): WHATWG URL spec의 base URL 결합 시 절대 URL이 base를 무시하는 동작 차단
 *
 * @returns 자사 origin 내부 URL. 외부 origin 감지 시 NEXT_PUBLIC_APP_URL 루트(/)로 fallback.
 */
export function resolveCallbackRedirect(rawRedirect: string): URL {
  const safeRedirect = sanitizeOAuthRedirect(rawRedirect);
  const appOrigin = new URL(getEnv().NEXT_PUBLIC_APP_URL);
  const target = new URL(safeRedirect, appOrigin);

  // 3차 방어: 결합 결과의 origin이 자사 origin과 다르면 외부 — `/` fallback.
  if (target.origin !== appOrigin.origin) {
    return new URL('/', appOrigin);
  }
  return target;
}
