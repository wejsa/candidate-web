// CANDID-050 Step 2 — 로그인 후 복원 redirect의 open-redirect 가드.
//
// `lib/auth/oauth/redirect.ts`의 sanitizeOAuthRedirect와 동일한 방어 규칙을 따르되,
// (1) 'server-only'가 아니어서 RSC·클라이언트·테스트 어디서나 호출 가능하고,
// (2) 로그인 흐름 fallback을 '/me'(마이페이지)로 둔다(OAuth는 '/').
// 두 함수는 의도적으로 같은 규칙을 공유하는 sibling 가드 — OAuth state 쿠키 흐름은
// 기존 함수를, 폼 기반 ?redirect 복원은 본 함수를 사용한다.
//
// 차단 대상(브라우저 URL 파싱 비대칭을 악용한 외부 도메인 우회):
//   - 비문자열/빈 값, 제어문자(tab/CR/LF 포함), `/`로 시작하지 않는 값
//   - protocol-relative `//evil.com`, backslash 우회 `/\evil.com`, 과도 길이

const MAX_REDIRECT_LENGTH = 2048;

/**
 * 내부 절대경로만 통과시키고, 그 외에는 fallback을 반환한다.
 * @param raw 사용자 제공 redirect 파라미터(쿼리스트링 등)
 * @param fallback 비정상 입력 시 대체 경로 (기본 '/me')
 */
export function safeInternalPath(
  raw: string | null | undefined,
  fallback = '/me',
): string {
  if (typeof raw !== 'string' || raw === '') return fallback;
  // 제어문자(0x00-0x1F, 0x7F) + tab/CR/LF — 브라우저 URL 파싱 비대칭 우회 차단.
  if (/[\x00-\x1F\x7F]/.test(raw)) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback; // protocol-relative
  if (raw.startsWith('/\\')) return fallback; // backslash 우회
  if (raw.length > MAX_REDIRECT_LENGTH) return fallback;
  return raw;
}
