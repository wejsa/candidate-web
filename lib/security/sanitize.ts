import 'server-only';
import DOMPurify, { type Config } from 'isomorphic-dompurify';

// CANDID-009 Step 3 — XSS Sanitizer (BR-SEC-05).
// 어드민 작성 HTML(공고 description)은 화이트리스트 sanitize, 사용자 일반 입력은 strip(plain).
// 저장 시점 + 출력 시점 양쪽에서 호출하여 이중 방어 (CLAUDE.md §"보안 강제 사항").
// isomorphic-dompurify는 server(jsdom) + browser 양쪽 지원 — Server Component/Route Handler에서 호출.
// **Edge runtime 미지원** — jsdom이 Node 모듈에 의존. middleware.ts에서 호출 금지.

/** Sanitize 프로필 — 입력 종류에 따른 화이트리스트 정책. */
export type SanitizeProfile = 'job-posting' | 'plain';

/** 공고 description용 — 한정된 인라인/블록 HTML 허용. 스크립트/이벤트 핸들러 차단. */
const JOB_POSTING_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'u',
    's',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'a',
  ],
  ALLOWED_ATTR: ['href', 'title'],
  // href는 ALLOWED_URI_REGEXP로 https/http/mailto만 허용 — javascript:/data: URI 차단.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  ALLOW_DATA_ATTR: false,
  // 명시적 차단 — DOMPurify 기본 차단되지만 회귀 방어.
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'form', 'input'],
  FORBID_ATTR: ['style', 'srcset'],
  KEEP_CONTENT: true,
};

/** 사용자 일반 텍스트 입력 — 모든 HTML strip, 텍스트만 보존. */
const PLAIN_CONFIG: Config = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
};

/**
 * 입력 문자열을 profile 정책에 따라 sanitize한다.
 * 빈/null 입력은 빈 문자열 반환 (방어 — 호출측이 ?? '' 같은 처리를 잊어도 안전).
 * Server-side(`jsdom`) DOMPurify 사용 — Edge runtime에서 호출 금지(`'use server'` 경계).
 */
export function sanitizeHtml(input: string | null | undefined, profile: SanitizeProfile): string {
  if (input === null || input === undefined || input === '') return '';
  const config = profile === 'job-posting' ? JOB_POSTING_CONFIG : PLAIN_CONFIG;
  return DOMPurify.sanitize(input, config);
}
