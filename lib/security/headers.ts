import 'server-only';
import type { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';

// CANDID-009 Step 1 — 표준 보안 헤더 빌더.
// 모든 응답에 부착되는 보안 헤더(OWASP Secure Headers Project 권고 기준) 정의.
// middleware.ts(Edge runtime)에서 호출 — Node 모듈 의존 금지.
// 동적 분기는 NODE_ENV뿐 — 요청별 분기는 호출측 책임.

/** 표준 보안 헤더 키-값 맵 — buildSecurityHeaders 결과는 동결되어 호출측 mutation 차단. */
export type SecurityHeaders = Readonly<Record<string, string>>;

/**
 * CSP(Content-Security-Policy) 정책 — dev/test는 Next HMR(eval, ws) 허용 위해 완화,
 * prod는 strict. nonce 도입(script-src 'nonce-...')은 후속 task에서 — MVP는 'self' 기반.
 *
 * connect-src에 S3/스토리지 엔드포인트 origin을 추가한다 — 이력서 첨부는 브라우저가 presigned URL로
 * S3/MinIO에 직접 PUT/GET하므로(cross-origin) connect-src에 없으면 CSP가 차단한다(US-APP-003).
 */
function contentSecurityPolicy(
  nodeEnv: 'production' | 'development' | 'test',
  storageOrigin: string | null,
): string {
  const connectExtra = storageOrigin !== null ? ` ${storageOrigin}` : '';
  const base = [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (nodeEnv === 'production') {
    return [
      ...base,
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'", // Tailwind/CSS-in-JS inline style 대응
      `connect-src 'self'${connectExtra}`,
      'upgrade-insecure-requests',
    ].join('; ');
  }
  // dev/test — Next.js HMR + eval/inline 허용. 운영에는 절대 사용하지 않는다.
  return [
    ...base,
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ws: wss:${connectExtra}`, // HMR websocket + 스토리지 직접 업로드
  ].join('; ');
}

/** S3_ENDPOINT에서 connect-src에 넣을 origin(scheme://host[:port])을 추출한다. 미설정/파싱 실패 시 null. */
function storageOriginFromEnv(s3Endpoint: string | undefined): string | null {
  if (s3Endpoint === undefined || s3Endpoint === '') return null;
  try {
    return new URL(s3Endpoint).origin;
  } catch {
    return null;
  }
}

/**
 * 모든 응답에 부착할 보안 헤더 맵을 빌드한다.
 * HSTS는 production 전용 — dev http 환경이 영구 캐시되어 접근 불가하게 되는 사고 방지.
 */
export function buildSecurityHeaders(): SecurityHeaders {
  const env = getEnv();
  const headers: Record<string, string> = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=()',
    'X-DNS-Prefetch-Control': 'off',
    'Content-Security-Policy': contentSecurityPolicy(
      env.NODE_ENV,
      storageOriginFromEnv(env.S3_ENDPOINT),
    ),
  };
  if (env.NODE_ENV === 'production') {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  }
  return Object.freeze(headers);
}

/** NextResponse에 보안 헤더를 in-place로 부착한다. 동일 응답 객체를 반환. */
export function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(buildSecurityHeaders())) {
    response.headers.set(name, value);
  }
  return response;
}
