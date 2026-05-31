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
 * CANDID-036에서 IP-기반 외에 **userId-bucket** 정책을 위한 별도 인터페이스
 * (`UserRateLimitPolicy`)와 helper(`withUserRateLimit`)를 도입했다.
 * IP-기반 정책은 본 `POLICIES`, userId-기반은 아래 `USER_POLICIES`에서 관리한다.
 *
 * **누락 정책 — FILE_UPLOAD**:
 * BR-SEC-04 "파일 30회/시간/**사용자**"는 CANDID-016에서 `USER_POLICIES`에 추가될 예정.
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
  /**
   * CANDID-036 (PR #33 H005): 무제한 POST DoS 차단.
   * 256-bit entropy로 brute force는 무의미하나, DB lookup 폭주 + 로그 폭주 차단이 목적.
   * NAT 환경 다수 사용자 동시 클릭 여유를 확보 (1분/30회 = 1초/0.5회).
   */
  VERIFY_EMAIL: Object.freeze({
    name: 'verify_email',
    windowMs: 60_000,
    maxRequests: 30,
    keyExtractor: rateLimitKeyByIp,
  } satisfies RateLimitPolicy),
  /**
   * CANDID-020 (US-AUTH-004) — 비밀번호 재설정 요청. 메일 발송 + 계정 열거 방지 흐름.
   * SIGNUP과 동일하게 시간당 5회/IP — 토큰 발급/메일 폭주 + 열거 시도(이메일 대량 탐침) 차단.
   */
  PASSWORD_RESET: Object.freeze({
    name: 'password_reset',
    windowMs: 3_600_000,
    maxRequests: 5,
    keyExtractor: rateLimitKeyByIp,
  } satisfies RateLimitPolicy),
});

/**
 * userId-기반 정책 — 인증된 라우터에서 사용자별 throttling.
 * `keyExtractor` 없이 외부에서 userId를 직접 전달받는다 (`withUserRateLimit` helper).
 */
export interface UserRateLimitPolicy {
  readonly name: string;
  readonly windowMs: number;
  readonly maxRequests: number;
}

/**
 * CANDID-036 — userId-bucket 정책 카탈로그.
 *
 * `POLICIES`(IP-기반)와 분리: 같은 윈도우의 IP+userId 복합 키 구성이 가능해
 * 향후 IP-회전 공격 + 정상 userId 매칭 시도를 이중 차단할 수 있다.
 */
export const USER_POLICIES = Object.freeze({
  /**
   * PR #33 H004: resend-verification user-bucket — 메일 폭주 차단.
   * 60s DB 쿨다운(1분/1통 잠재 = 60통/시간)에 더해 시간당 3통으로 강제.
   * IP 기반 SIGNUP(5회/시간/IP)과 병용 — IP-회전 공격에도 user 단위 제한 유지.
   */
  RESEND_VERIFICATION_USER: Object.freeze({
    name: 'resend_verification_user',
    windowMs: 3_600_000,
    maxRequests: 3,
  } satisfies UserRateLimitPolicy),
  /**
   * CANDID-022 Step 3 — 회원 탈퇴 user-bucket. 비밀번호 무차별 + 의도치 않은 다중 호출 차단.
   * 시간당 3회: 정상 사용자는 한 번이면 충분, 우발/스크립트 오류 케이스만 흡수.
   */
  WITHDRAW_USER: Object.freeze({
    name: 'withdraw_user',
    windowMs: 3_600_000,
    maxRequests: 3,
  } satisfies UserRateLimitPolicy),
  /**
   * CANDID-024 Step 2 — 프로필 수정(이름/연락처) user-bucket. 저빈도 작업이나 PII 재암호화
   * 폭주 + 스크립트 오류 다중 호출 차단. 시간당 20회: 정상 편집/재시도 흡수, 남용은 차단.
   */
  PROFILE_UPDATE_USER: Object.freeze({
    name: 'profile_update_user',
    windowMs: 3_600_000,
    maxRequests: 20,
  } satisfies UserRateLimitPolicy),
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

/**
 * 응답에 표준 X-RateLimit-* 헤더를 부착한다 (RFC 6585 + GitHub/Twitter 관행).
 *
 * CANDID-037 (L-023) — wrapper 합성 시 inner 헤더 보호:
 * 외부 `withRateLimit`이 inner `withUserRateLimit`/`enforceUserRateLimit`의 응답에
 * 부착된 헤더를 덮어쓰지 않도록, `X-RateLimit-Policy`가 이미 존재하면 set을 스킵한다.
 * inner 정책 정보가 클라이언트 backoff에 더 유용하며 운영 메트릭 분류도 정확해진다.
 */
function applyRateLimitHeaders(
  response: Response | NextResponse,
  policy: RateLimitPolicy,
  probe: RateLimitProbe,
): void {
  if (response.headers.has('X-RateLimit-Policy')) {
    // inner wrapper/helper가 이미 부착 — override 회피 (L-023).
    return;
  }
  response.headers.set('X-RateLimit-Limit', String(policy.maxRequests));
  response.headers.set('X-RateLimit-Remaining', String(probe.remaining));
  response.headers.set('X-RateLimit-Policy', policy.name);
  if (probe.limited) {
    response.headers.set('Retry-After', String(Math.ceil(probe.retryAfterMs / 1000)));
  }
}

/**
 * userId-기반 정책의 표준 헤더 부착 — `applyRateLimitHeaders`와 동일 시맨틱.
 *
 * L-023: `X-RateLimit-Policy`가 이미 존재하면 inner가 부착한 것으로 간주하고 스킵.
 * 본 헬퍼는 inner(user-bucket) 자체이므로 정상 path에서는 outer 헤더보다 먼저 호출되어
 * 자신의 정책을 응답에 새긴다. outer `withRateLimit`이 후속 호출 시 가드에 걸려 보존된다.
 */
function applyUserRateLimitHeaders(
  response: Response | NextResponse,
  policy: UserRateLimitPolicy,
  probe: RateLimitProbe,
): void {
  if (response.headers.has('X-RateLimit-Policy')) {
    return;
  }
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
 * userId-기반 정책 검사 — 외부 호출용. handler 외부에서 직접 사용 가능.
 *
 * CANDID-036 — `checkRateLimit`의 IP-키 추출 단계 없이 userId를 키로 직접 사용.
 * 한도 초과 여부와 retryAfter를 동일 `RateLimitProbe` 형태로 반환.
 */
export function checkUserRateLimit(
  policy: UserRateLimitPolicy,
  userId: number | string,
  now: number = Date.now(),
): RateLimitProbe {
  const key = `${policy.name}:user:${userId}`;
  const windowStart = now - policy.windowMs;
  const existing = buckets.get(key) ?? [];
  let pruneIdx = 0;
  while (pruneIdx < existing.length && existing[pruneIdx]! <= windowStart) pruneIdx++;
  const pruned = pruneIdx > 0 ? existing.slice(pruneIdx) : existing;

  if (pruned.length >= policy.maxRequests) {
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

/**
 * 인증된 Route Handler를 감싸 userId-기반 정책을 강제한다.
 *
 * CANDID-036 — `withRateLimit`은 IP-키, 본 helper는 userId-키. 인증 미들웨어 통과 후
 * userId가 결정된 시점에 호출. 한도 초과 시 표준 429 + X-RateLimit-* / Retry-After.
 *
 * @deprecated CANDID-037 — wrapper IIFE 합성은 헤더 override / 패턴 비일관 이슈가 있어
 * `enforceUserRateLimit` 인라인 헬퍼로 교체 권장. 다음 PR에서 본 함수 제거 예정.
 * 현재 호출자: app/api/v1/auth/resend-verification/route.ts (Step 3에서 마이그레이션).
 */
export function withUserRateLimit<C = unknown>(
  policy: UserRateLimitPolicy,
  userId: number | string,
  handler: ApiRouteHandler<C>,
): ApiRouteHandler<C> {
  return async (request, context) => {
    const probe = checkUserRateLimit(policy, userId);
    if (probe.limited) {
      const response = errorResponse(request, 'SYS_RATE_LIMITED');
      applyUserRateLimitHeaders(response, policy, probe);
      return response;
    }
    const response = await handler(request, context);
    applyUserRateLimitHeaders(response, policy, probe);
    return response;
  };
}

/**
 * userId-기반 정책의 인라인 enforcement helper (CANDID-037 — wrapper IIFE 대체).
 *
 * 사용 패턴 — 호출자가 정상 path 응답에 헤더 부착 책임을 가진다:
 * ```typescript
 * const { userId } = await requireAuth(request);
 * const userRateLimit = enforceUserRateLimit(
 *   USER_POLICIES.RESEND_VERIFICATION_USER, userId, request,
 * );
 * if (userRateLimit.response !== null) return userRateLimit.response; // 429 (헤더 포함)
 *
 * // ... biz logic ...
 * const finalResponse = NextResponse.json({...});
 * userRateLimit.attachHeaders(finalResponse); // 정상 응답에 X-RateLimit-* 부착
 * return finalResponse;
 * ```
 *
 * 외부 `withRateLimit`이 후속 헤더 부착 시 `applyRateLimitHeaders`의 L-023 가드로
 * inner(user-bucket) 헤더가 보존된다.
 */
export interface UserRateLimitGate {
  /** 한도 초과 시 헤더 부착된 429 Response. 정상 path에서는 `null`. */
  readonly response: Response | null;
  /** 정상 path에서 호출자가 최종 응답에 user-bucket 헤더를 부착하기 위한 helper. */
  readonly attachHeaders: (response: Response | NextResponse) => void;
}

export function enforceUserRateLimit(
  policy: UserRateLimitPolicy,
  userId: number | string,
  request: NextRequest,
): UserRateLimitGate {
  const probe = checkUserRateLimit(policy, userId);
  if (probe.limited) {
    const response = errorResponse(request, 'SYS_RATE_LIMITED');
    applyUserRateLimitHeaders(response, policy, probe);
    return {
      response,
      attachHeaders: () => {
        /* limited 분기에서는 호출자 응답이 별도로 만들어지지 않음 — no-op */
      },
    };
  }
  return {
    response: null,
    attachHeaders: (response) => applyUserRateLimitHeaders(response, policy, probe),
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
