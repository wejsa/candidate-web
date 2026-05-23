import 'server-only';
import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';

// CANDID-009 Step 1 — CORS 화이트리스트 + preflight 응답.
// BR-SEC-03: 운영 도메인 화이트리스트, 와일드카드 금지.
// 허용 origin = NEXT_PUBLIC_APP_URL.origin ∪ CORS_ALLOWED_ORIGINS(CSV → 배열).
// Edge runtime 호환 — URL constructor만 사용.

let cachedAllowed: ReadonlySet<string> | null = null;

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * 허용 origin 집합을 반환. NEXT_PUBLIC_APP_URL의 origin이 항상 포함되고
 * CORS_ALLOWED_ORIGINS의 추가 항목이 합쳐진다. 결과는 동결되어 호출측이 mutate 불가.
 * 캐시는 __resetCorsCacheForTesting으로 초기화 (L-002 패턴).
 */
export function getAllowedOrigins(): ReadonlySet<string> {
  if (cachedAllowed !== null) return cachedAllowed;
  const env = getEnv();
  const set = new Set<string>();
  const base = originOf(env.NEXT_PUBLIC_APP_URL);
  if (base !== '') set.add(base);
  for (const raw of env.CORS_ALLOWED_ORIGINS.split(',')) {
    const trimmed = raw.trim();
    // env refine이 `*`를 차단하지만 빈 문자열·잘못된 URL은 정상값으로 통과할 수 있어 이중 방어.
    if (trimmed === '' || trimmed === '*') continue;
    const origin = originOf(trimmed);
    if (origin !== '') set.add(origin);
  }
  cachedAllowed = Object.freeze(set);
  return cachedAllowed;
}

/**
 * 요청 Origin이 화이트리스트에 있으면 정규화된 origin을 반환, 아니면 null.
 * Step 3 보강(MAJOR-SEC-2): URL constructor로 origin 정규화 (대소문자/기본 포트/trailing slash).
 * 정당 요청 false-positive 차단(`https://Candidate.example.com:443` → 매칭).
 */
export function resolveAllowedOrigin(origin: string | null): string | null {
  if (origin === null || origin === '') return null;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return null;
  }
  return getAllowedOrigins().has(normalized) ? normalized : null;
}

function appendVary(response: NextResponse, value: string): void {
  const current = response.headers.get('Vary');
  if (current === null || current === '') {
    response.headers.set('Vary', value);
    return;
  }
  const parts = current.split(',').map((p) => p.trim().toLowerCase());
  if (!parts.includes(value.toLowerCase())) {
    response.headers.set('Vary', `${current}, ${value}`);
  }
}

/**
 * 응답에 CORS 헤더를 부착한다.
 * Origin이 화이트리스트면 Allow-Origin/Allow-Credentials를 세팅.
 * Vary: Origin은 항상 부착 — CDN/캐시가 Origin별 응답을 구분하도록 한다.
 */
export function applyCorsHeaders(
  response: NextResponse,
  requestOrigin: string | null,
): NextResponse {
  appendVary(response, 'Origin');
  const allowed = resolveAllowedOrigin(requestOrigin);
  if (allowed !== null) {
    response.headers.set('Access-Control-Allow-Origin', allowed);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return response;
}

/**
 * OPTIONS preflight 응답을 생성. Origin이 허용되지 않으면 ACAO 없는 204(브라우저가 차단).
 * 허용 시 Methods/Headers/Max-Age까지 세팅 — 인증 우회 우려가 없는 OPTIONS는 미들웨어에서 종결.
 */
export function buildPreflightResponse(request: { headers: Headers }): NextResponse {
  const origin = request.headers.get('origin');
  const requestedMethod = request.headers.get('access-control-request-method') ?? '';
  const requestedHeaders = request.headers.get('access-control-request-headers') ?? '';
  const response = new NextResponse(null, { status: 204 });
  applyCorsHeaders(response, origin);
  if (resolveAllowedOrigin(origin) !== null) {
    response.headers.set(
      'Access-Control-Allow-Methods',
      requestedMethod !== '' ? requestedMethod : 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    response.headers.set(
      'Access-Control-Allow-Headers',
      requestedHeaders !== '' ? requestedHeaders : 'Content-Type, Authorization, Idempotency-Key',
    );
    response.headers.set('Access-Control-Max-Age', '600');
  }
  return response;
}

/**
 * 테스트 전용 — origin 캐시 초기화 (L-002 패턴).
 * production 호출 시 throw — 운영 안전 가드.
 * @internal
 */
export function __resetCorsCacheForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetCorsCacheForTesting must not be called in production');
  }
  cachedAllowed = null;
}
