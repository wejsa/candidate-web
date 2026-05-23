import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { errorResponse } from '@/lib/errors';

// CANDID-009 Step 2 — Rate Limit 카탈로그 + sliding-window in-memory 리미터.
// BR-SEC-04: 로그인 10회/분/IP, 회원가입 5회/시간/IP, 파일 30회/시간/사용자.
//
// 구조: Map<key, timestamps[]>. 매 호출마다 window 밖 항목을 prune 후 길이로 한도 비교.
// L-002 학습 반영: 모듈 캐시는 __resetRateLimitStateForTesting 동반 export.
// Edge runtime 호환: Map/Date만 사용. Route Handler(Node) 진입점에서 호출하는 것을 권장 —
// Edge multi-instance 환경에서는 인스턴스별 격리되어 한도 효력이 인스턴스 수만큼 곱해진다 (plan §6).
//
// **사용 위치**: Route Handler에 `withRateLimit(POLICIES.LOGIN, handler)`로 감싸 적용.
// middleware에서 호출 금지 — Edge runtime + 멀티 인스턴스 환경의 결합으로 효력 약화.

/** Route Handler 시그니처 — lib/errors/response.ts ApiRouteHandler와 정합. */
type ApiRouteHandler<C> = (request: NextRequest, context: C) => Response | Promise<Response>;

export interface RateLimitPolicy {
  /** 정책 식별자 — 로깅/메트릭/X-RateLimit-Policy 헤더에 표시. */
  readonly name: string;
  /** 윈도우 크기 (밀리초). 60_000=1분, 3_600_000=1시간. */
  readonly windowMs: number;
  /** 윈도우 내 최대 허용 요청 수. */
  readonly maxRequests: number;
  /**
   * 카운팅 키 추출자. IP/사용자 ID 등으로 다른 정책끼리 격리.
   * 인증 미들웨어 통과 전이면 IP만 사용. 사용자별은 인증 후 user_id 기반.
   */
  readonly keyExtractor: (request: NextRequest) => string;
}

/**
 * IP 키 추출 — Step 3 보강(MAJOR-SEC-1): TRUST_PROXY env 분리.
 * `TRUST_PROXY=true` (신뢰 LB/CDN 뒤)인 경우에만 X-Forwarded-For/X-Real-IP 우선.
 * `TRUST_PROXY=false` (기본, 직접 노출 환경)에서는 NextRequest.ip만 사용 — 클라이언트의
 * 헤더 위조로 카운터 격리 우회를 차단. 부재 시 'unknown' 단일 키로 수렴(공격 노출 최소화).
 * isSecureRequest(middleware.ts)의 신뢰 모델과 동일한 게이트 — 한 곳에서 결정.
 */
export function rateLimitKeyByIp(request: NextRequest): string {
  const env = getEnv();
  if (env.TRUST_PROXY) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded !== null && forwarded !== '') {
      const first = forwarded.split(',')[0]?.trim() ?? '';
      if (first !== '') return `ip:${first}`;
    }
    const real = request.headers.get('x-real-ip');
    if (real !== null && real !== '') return `ip:${real}`;
  }
  // TRUST_PROXY=false 또는 신뢰 헤더 부재 — NextRequest.ip(Edge runtime 제공) 폴백.
  // 부재 시 'unknown' — 단일 키로 수렴해 위조로 격리 우회 차단(보수적 trade-off).
  const directIp = (request as { ip?: string }).ip ?? '';
  return directIp !== '' ? `ip:${directIp}` : 'ip:unknown';
}

/**
 * BR-SEC-04 정책 카탈로그 — 변경 시점이 곧 SSOT. 호출측은 import해서 사용.
 *
 * **누락 정책 — FILE_UPLOAD**:
 * BR-SEC-04는 "파일 30회/시간/**사용자**"를 요구하나, 사용자별 카운팅에는
 * `withRateLimit` 호출 *시점에 이미 인증이 완료*되어 userId가 알려져 있어야 한다.
 * 현재 keyExtractor 시그니처(`(request) => string`)는 인증 후 context를 받지 못하므로
 * 카탈로그에 잘못된 IP 기반 정책을 노출하면 후속 task(CANDID-016 파일 업로드)가
 * 그대로 import해 BR-SEC-04 위반(IP-NAT 공유 환경에서 합법 사용자 차단)이 silent로 일어난다.
 * 따라서 본 Step 2는 LOGIN/SIGNUP만 정의하고, FILE_UPLOAD는 CANDID-016에서
 * `withRateLimit` 시그니처를 (request, AuthContext) → string으로 확장하거나
 * `withUserRateLimit(policy, userId, handler)` 변형을 도입하면서 함께 정의한다.
 */
export const POLICIES = Object.freeze({
  LOGIN: Object.freeze({
    name: 'login',
    windowMs: 60_000,
    maxRequests: 10,
    keyExtractor: rateLimitKeyByIp,
  } satisfies RateLimitPolicy),
  SIGNUP: Object.freeze({
    name: 'signup',
    windowMs: 3_600_000,
    maxRequests: 5,
    keyExtractor: rateLimitKeyByIp,
  } satisfies RateLimitPolicy),
});

/** Map<`${policy}:${key}`, timestamps[]> — 모듈 lifetime 동안 in-memory 유지. */
const buckets = new Map<string, number[]>();

function bucketKey(policy: RateLimitPolicy, request: NextRequest): string {
  return `${policy.name}:${policy.keyExtractor(request)}`;
}

/** sliding window prune + 카운팅 — 외부 호출용 (HOF 외 직접 검증/디버깅). */
export interface RateLimitProbe {
  /** 윈도우 내 현재 요청 수 (본 호출 포함). */
  count: number;
  /** 남은 허용 수 (maxRequests - count, 음수면 0). */
  remaining: number;
  /** 한도 초과 여부. */
  limited: boolean;
  /** 한도 초과 시 가장 오래된 요청이 windowMs 밖으로 빠질 시각(ms). limited=false면 0. */
  retryAfterMs: number;
}

/** 현재 시점에서 정책을 검사하고 timestamps에 *조건부* 기록한다. limited=true면 미기록. */
export function checkRateLimit(
  policy: RateLimitPolicy,
  request: NextRequest,
  now: number = Date.now(),
): RateLimitProbe {
  const key = bucketKey(policy, request);
  const windowStart = now - policy.windowMs;
  const existing = buckets.get(key) ?? [];
  // 윈도우 밖 prune — sorted 가정(매 push가 now이므로 자연 증가)으로 binary search 없이도 O(n).
  let pruneIdx = 0;
  while (pruneIdx < existing.length && existing[pruneIdx]! <= windowStart) pruneIdx++;
  const pruned = pruneIdx > 0 ? existing.slice(pruneIdx) : existing;

  if (pruned.length >= policy.maxRequests) {
    // 한도 초과 — 기록하지 않음 (영구 lockout 방지). retryAfter는 가장 오래된 요청 기준.
    buckets.set(key, pruned);
    const oldest = pruned[0] ?? now;
    return {
      count: pruned.length,
      remaining: 0,
      limited: true,
      retryAfterMs: Math.max(0, oldest + policy.windowMs - now),
    };
  }
  pruned.push(now);
  buckets.set(key, pruned);
  return {
    count: pruned.length,
    remaining: Math.max(0, policy.maxRequests - pruned.length),
    limited: false,
    retryAfterMs: 0,
  };
}

/** 응답에 표준 X-RateLimit-* 헤더를 부착한다 (RFC 6585 + GitHub/Twitter 관행). */
function applyRateLimitHeaders(
  response: Response | NextResponse,
  policy: RateLimitPolicy,
  probe: RateLimitProbe,
): void {
  response.headers.set('X-RateLimit-Limit', String(policy.maxRequests));
  response.headers.set('X-RateLimit-Remaining', String(probe.remaining));
  response.headers.set('X-RateLimit-Policy', policy.name);
  if (probe.limited) {
    response.headers.set('Retry-After', String(Math.ceil(probe.retryAfterMs / 1000)));
  }
}

/**
 * Route Handler를 감싸 정책을 강제한다.
 *
 * Step 3 보강(H001/H002 — Step 2 review):
 * - 한도 초과 시 throw 대신 errorResponse를 직접 반환 → X-RateLimit-* / Retry-After 헤더가
 *   429 응답에 부착되어 클라이언트의 표준 backoff 로직 가용(RFC 6585).
 * - 운영 메타데이터(policy/retryAfterSec)를 details에 담는 대신 헤더 채널로만 노출
 *   (ErrorDetail 시맨틱은 입력 필드 검증 전용).
 *
 * 사용: `export const POST = withErrorHandler(withRateLimit(POLICIES.LOGIN, async (req) => {...}));`
 */
export function withRateLimit<C = unknown>(
  policy: RateLimitPolicy,
  handler: ApiRouteHandler<C>,
): ApiRouteHandler<C> {
  return async (request, context) => {
    const probe = checkRateLimit(policy, request);
    if (probe.limited) {
      const response = errorResponse(request, 'SYS_RATE_LIMITED');
      applyRateLimitHeaders(response, policy, probe);
      return response;
    }
    const response = await handler(request, context);
    applyRateLimitHeaders(response, policy, probe);
    return response;
  };
}

/**
 * 테스트 전용 — 모든 정책의 카운터를 초기화. (L-002 패턴)
 * production 호출 시 throw — 운영 안전 가드.
 * @internal
 */
export function __resetRateLimitStateForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetRateLimitStateForTesting must not be called in production');
  }
  buckets.clear();
}
