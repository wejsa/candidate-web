# 보안 컨트롤 가이드 (CANDID-009)

본 문서는 candidate-web의 보안 미들웨어/헬퍼/정책을 정리한다. 후속 라우트(CANDID-010~018)는 본 가이드의 헬퍼를 호출해 BR-SEC-01~07을 충족한다.

> 본 문서의 3-Layer는 *요청 흐름 축* (Edge → Route → Application). **PII 데이터 보호의 3-Layer Defense** (D6 정적 / D7 직렬화 / D8 런타임)는 별도 축이며 [docs/security/pii-encryption.md §5](pii-encryption.md) 참조.

## 3-Layer Defense 개요 (요청 흐름)

| 계층 | 위치 | 책임 |
|------|------|------|
| **Edge (전역)** | `middleware.ts` | HTTPS 강제 (BR-SEC-01), 보안 헤더, CORS (BR-SEC-03), CSRF Origin 검증 (BR-SEC-02) |
| **Route (행위별)** | `withRateLimit` HOF | IP/사용자 단위 rate limit (BR-SEC-04) |
| **Application (입력)** | `sanitizeHtml` | XSS 방어 (BR-SEC-05) — 저장 + 출력 양쪽에서 호출 |

## Edge 계층 — `middleware.ts`

매 요청에 다음을 적용한다:

1. **HTTPS 강제** (`FORCE_HTTPS_REDIRECT=true` 시)
   - `nextUrl.host`가 화이트리스트면 308 redirect, 미일치면 421 Misdirected (open redirect 차단)
   - `X-Forwarded-Proto`는 `TRUST_PROXY=true`(신뢰 LB 뒤)일 때만 신뢰
2. **CORS preflight** — OPTIONS는 미들웨어에서 즉시 종결 (Route Handler 미도달)
3. **CSRF Origin 검증** — state-changing methods(POST/PUT/PATCH/DELETE)에 한해 Origin이 화이트리스트인지 확인. 위반 시 403 `SYS_FORBIDDEN_ORIGIN`. GET/HEAD/OPTIONS는 통과. Origin 부재는 SameSite=Lax 결합으로 통과(주의: 비-브라우저 클라이언트는 별도 정책 필요)
4. **보안 헤더 부착** — CSP (dev/prod 분기), HSTS (prod), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy

### 신뢰 모델: TRUST_PROXY 환경 변수

| 환경 | TRUST_PROXY | X-Forwarded-Proto / -For 신뢰 |
|------|:-----------:|:----------------------------:|
| 운영 (LB/CDN 뒤) | `true` | 신뢰 — 정확한 클라이언트 IP/프로토콜 |
| dev / 직접 노출 | `false` (기본) | 무시 — 클라이언트 위조 가능 |

⚠️ 운영 배포 시 `TRUST_PROXY=true`와 LB 설정(X-Forwarded-* 헤더 부착)이 함께 갖춰지지 않으면 HTTPS 강제와 IP 기반 rate limit이 무력화된다.

## Route 계층 — `withRateLimit` HOF

BR-SEC-04 정책 카탈로그 (`lib/security/rate-limit.ts`):

| 정책 | 한도 | 윈도우 | 키 | 부착 라우트 |
|------|:----:|:------:|---|------------|
| `POLICIES.LOGIN` | 10회 | 1분 | IP | POST `/api/v1/auth/login` (CANDID-011) |
| `POLICIES.SIGNUP` | 5회 | 1시간 | IP | POST `/api/v1/auth/signup` (CANDID-010) |
| ❌ FILE_UPLOAD | 30회 | 1시간 | **사용자** | (미정의 — CANDID-016에서 시그니처 확장과 함께 도입) |

### 사용 예시 (CANDID-011 로그인 라우트)

```typescript
import { withErrorHandler } from '@/lib/errors';
import { POLICIES, withRateLimit } from '@/lib/security/rate-limit';

export const POST = withErrorHandler(
  withRateLimit(POLICIES.LOGIN, async (request) => {
    // ... 로그인 로직
    return NextResponse.json({ ok: true });
  }),
);
```

### 응답 헤더 계약 (RFC 6585)

| 헤더 | 값 | 부착 시점 |
|------|---|---------|
| `X-RateLimit-Limit` | 정책 최대 요청 수 | 항상 |
| `X-RateLimit-Remaining` | 남은 허용 수 | 항상 |
| `X-RateLimit-Policy` | 정책 이름 (login/signup) | 항상 |
| `Retry-After` | 재시도 가능까지 초 | 429 응답에만 |

### 운영 한계 — In-Memory + 멀티 인스턴스

- **현재 구현**: `Map<key, timestamps[]>`를 모듈 lifetime 캐시. **단일 인스턴스 가정**
- **수평 확장 영향**: N개 인스턴스 → 실효 한도 N×설정값. BR-SEC-04 의미론 약화
- **Edge runtime 영향**: middleware에서 `withRateLimit` 호출 금지 — Edge는 region별 분산되어 격리 불가
- **Redis 도입 트리거**: 멀티 인스턴스 배포 또는 BR-SEC 감사 요구 발생 시 `RateLimitStore` 인터페이스 추상화 후 `@upstash/ratelimit` 등으로 교체

## Application 계층 — `sanitizeHtml`

```typescript
import { sanitizeHtml } from '@/lib/security/sanitize';

// 어드민 작성 공고 description (제한된 HTML 허용)
const safeHtml = sanitizeHtml(jobPosting.description, 'job-posting');

// 사용자 일반 텍스트 (자기소개서 등 — 모든 HTML strip)
const plainText = sanitizeHtml(userInput, 'plain');
```

### Profile 정책

| Profile | 허용 | 차단 |
|---------|------|------|
| `job-posting` | `<p>/<h1-6>/<strong>/<em>/<ul>/<ol>/<li>/<blockquote>/<code>/<pre>/<a href="https?:&#124;mailto:">` | `<script>/<iframe>/<object>/<embed>/<style>/<form>/<input>`, `on*` 이벤트 핸들러, `javascript:`/`data:` URI, `style=` 속성 |
| `plain` | (없음 — 텍스트만 보존) | 모든 HTML 태그 |

### 이중 방어 원칙

저장(write) 시점과 출력(read/render) 시점 양쪽에서 호출. 저장 시점 sanitize가 누락된 레거시 데이터를 출력 sanitize가 방어한다.

### Edge runtime 미지원

`sanitizeHtml`은 `isomorphic-dompurify` → `jsdom` 의존으로 Edge runtime에서 동작하지 않는다. **Server Component / Route Handler / Server Action에서만 호출**한다. middleware.ts 호출 금지.

## 에러 코드 (`lib/errors/codes.ts`)

| 코드 | HTTP | 트리거 |
|------|:----:|--------|
| `SYS_FORBIDDEN_ORIGIN` | 403 | middleware CSRF Origin 검증 실패 |
| `SYS_RATE_LIMITED` | 429 | `withRateLimit` 한도 초과 (`Retry-After` 헤더 동봉) |

응답은 표준 7필드 포맷 (`{timestamp, status, code, message, path, traceId, details?}`) — `lib/errors/response.ts` `errorResponse`가 자동 채움.

## 환경 변수 요약 (`.env.example` 참조)

| 변수 | 기본 | 운영 권장 | 효과 |
|------|------|----------|------|
| `FORCE_HTTPS_REDIRECT` | `false` | `true` | HTTP → HTTPS 308 redirect |
| `TRUST_PROXY` | `false` | `true` (LB 뒤) | X-Forwarded-Proto/For 신뢰 |
| `CORS_ALLOWED_ORIGINS` | `''` (NEXT_PUBLIC_APP_URL만) | 멀티 도메인 시 CSV | CORS + CSRF Origin 화이트리스트 |

## 미해결/이연 항목

| 항목 | 사유 | 후속 |
|------|------|------|
| CSP `style-src 'unsafe-inline'` | Tailwind/styled-jsx 영향 검증 필요 | 후속 task — nonce 또는 hash 도입 |
| `buildSecurityHeaders` 매 요청 재계산 | perf 최적화 (캐시 + reset helper) | follow-up backlog |
| Permissions-Policy 추가 차단 항목 (usb/autoplay 등) | 점진적 강화 | follow-up |
| COOP/CORP 헤더 | cross-origin isolation (third-party 영향 검증 필요) | follow-up |
| 차단/한도 초과 이벤트 로깅 | OWASP A09 — 감사 추적 | CANDID-026 감사 로그 task |
| ESLint `no-restricted-imports`로 middleware의 rate-limit 호출 차단 | 휴먼 에러 방지 | follow-up |
