# PG Gateway API - 독립 프로젝트

## 프로젝트 개요

PG(Payment Gateway) 시스템의 API Gateway 서비스.
JWT 인증, 라우팅, Rate Limiting, 보안 기능을 담당합니다.

### 기술 스택
- **JDK**: 21 LTS (Virtual Threads 지원)
- **Kotlin**: 2.0.21
- **Spring Boot**: 3.3.7
- **Spring Cloud Gateway**: 4.1.x
- **Spring Cloud**: 2023.0.4
- **JJWT**: 0.12.6
- **Gradle**: 8.12

### 마이그레이션 원본
- `C:/workspace/new_pg/services/gateway-api/`
- 상세 계획: `docs/migration-plan.md`

---

## 세션 시작 시 필수

```bash
# 1. 최신 상태 동기화
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  # Worktree 모드 (Claude Squad 등)
  git fetch origin develop
  git merge origin/develop
else
  git checkout develop
  git pull origin develop
fi

# 2. 상태 요약 보기
/skill-status

# 3. 다음 작업 가져오기
/skill-plan
```

---

## 상태 관리 (Git 기반 SSOT)

```
.claude/state/              # Git 관리
├── backlog.json            # 백로그 + 상태 + Phase
└── completed.json          # 완료 이력

.claude/temp/               # 임시 파일 (Git 제외)
└── {taskId}-plan.md        # Task별 상세 계획
```

**Git clone/pull이 곧 동기화입니다.**

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ admin-portal │  │merchant-portal│  │ Payment SDK │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                 pg-gateway :10080                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Filters: TraceId → Logging → RateLimit → JWT Auth   │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Services: Auth, JWT, Cache, RateLimit, AuditLog     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│payment-service │ │settlement-svc  │ │merchant-service│
│    :10081      │ │    :10082      │ │    :10083      │
└────────────────┘ └────────────────┘ └────────────────┘
```

---

## 주요 스킬

```bash
/skill-status         # 상태 확인
/skill-backlog        # 백로그 조회
/skill-feature        # 새 기능 기획 (요구사항 + backlog 등록)
/skill-plan           # 다음 작업 + 설계 + 스텝 분리 계획 수립
/skill-impl           # 스텝 개발 + PR 생성
/skill-review         # 코드 리뷰 (5관점)
/skill-review-pr {num}  # PR 코드 리뷰
/skill-merge-pr {num}   # PR 머지
/skill-docs           # 참고자료 (결제/정산/보안)
```

---

## 자연어 명령어

| 자연어 | 스킬 | 동작 |
|--------|------|------|
| "상태 확인해줘" | `/skill-status` | 프로젝트 상태 확인 |
| "백로그 보여줘" | `/skill-backlog` | 백로그 조회 |
| "다음 작업 가져와줘" | `/skill-plan` | Task 선택 + 설계 + 스텝 계획 |
| "새 기능 기획해줘: {기능명}" | `/skill-feature {기능명}` | 새 기능 기획 + 요구사항 문서 |
| "새 기능 추천해줘" | `/skill-feature` | Gateway 전문가 관점 기능 추천 |
| "개발 진행해줘" | `/skill-impl` | Step 1 개발 -> PR 생성 |
| "다음 스텝 진행해줘" | `/skill-impl --next` | 다음 스텝 개발 -> PR 생성 |
| "전체 개발 진행해줘" | `/skill-impl --all` | 모든 스텝 연속 개발 |
| "{경로} 코드 리뷰해줘" | `/skill-review {경로}` | 코드 경로 종합 리뷰 |
| "PR {번호} 리뷰해줘" | `/skill-review-pr {번호}` | PR 리뷰 |
| "PR {번호} 머지해줘" | `/skill-merge-pr {번호}` | PR 머지 |
| "결제 플로우 참고자료" | `/skill-docs payment` | 결제 참고자료 조회 |

---

## 에이전트

### 통합 리뷰어: @agent-reviewer

5가지 전문 관점을 통합하여 순차적으로 검토하는 단일 에이전트:

| 관점 | 주요 체크 항목 |
|------|---------------|
| 1️⃣ 컴플라이언스 | PCI-DSS, 전자금융감독규정, 개인정보보호법, 감사로그 |
| 2️⃣ 도메인 | 상태머신, BigDecimal, 멱등성, 정산 일관성 |
| 3️⃣ 아키텍처 | Circuit Breaker, Saga, 장애격리, WebFlux 블로킹 금지 |
| 4️⃣ 보안 | JWT 로깅금지, SQL Injection, XSS, Rate Limiting |
| 5️⃣ 테스트 품질 | 커버리지 80%, 실패 케이스, 동시성 테스트 |

### 개발/운영용 에이전트

| 에이전트 | 역할 | 트리거 |
|---------|------|--------|
| `@agent-developer` | 백엔드 개발 | "구현", "코드 작성", "테스트 코드" |

---

## 개발 시 자동 참조 규칙

결제/정산/환불 관련 기능 구현 시:
1. 관련 키워드 감지 → `/skill-docs` 참고자료 참조
2. 참고자료 기반으로 구현
3. 참조한 문서 명시 (출처 표기)

### skill-docs 자동 참조 트리거

| 키워드/상황 | 참조 문서 |
|------------|----------|
| 결제, 승인, 인증 | `payment-flow.md` |
| 정산, 수수료, D+N | `settlement.md` |
| 취소, 환불, 부분취소 | `refund-cancel.md` |
| PCI-DSS, 암호화, 마스킹 | `security-compliance.md` |
| API 설계, 웹훅, 멱등성 | `api-design.md` |
| 에러코드, 재시도, 장애 | `error-handling.md` |
| 토스, 토스페이먼츠, 간편결제 | `tosspayments.md` |
| 나이스, NICE, VAN, 카드승인 | `nicepayments.md` |

---

## 워크플로우

### 새 기능 (기획부터)

```
/skill-feature "Redis 분산 캐시"
  ↓
요구사항 정의 -> docs/requirements/PG-GW-XXX-spec.md
  ↓
사용자 검토/승인
  ↓
backlog.json에 Task 등록
  ↓
/skill-plan으로 설계 + 계획 수립
```

### 기존 Task 개발 (마이그레이션 포함)

```
/skill-plan
  ↓
Task 선택 -> 요구사항/원본 소스 확인 -> 설계 -> 스텝 분리 계획
  ↓
(사용자 설계/계획 검토)
  ↓
/skill-impl 또는 "개발 진행해줘"
  ↓
Step 1 개발 -> PR 자동 생성
  ↓
/skill-review-pr {번호} 또는 "PR {번호} 리뷰해줘"
  ↓
(수정 필요 시 수정 -> 커밋 -> 푸시)
  ↓
/skill-merge-pr {번호} 또는 "PR {번호} 머지해줘"
  ↓
/skill-impl --next 또는 "다음 스텝 진행해줘"
  ↓
(반복)
  ↓
마지막 스텝 머지 -> 전체 완료
```

---

## Git 브랜치 전략

### 브랜치 구조
```
main (운영)
  └── develop (개발 통합)
        ├── feature/PG-GW-XXX-stepN (스텝별 개발)
        ├── bugfix/PG-GW-XXX-버그명 (버그 수정)
        └── hotfix/PG-GW-XXX-긴급수정 (긴급 패치)
```

### PR 규칙
- PR은 develop 브랜치로 생성
- 리뷰 승인 후 Squash 머지
- **스텝별 PR 생성** (500라인 미만 단위)
- PR 생성: `/skill-impl` 스텝 완료 시 자동 처리
- PR 리뷰: `/skill-review-pr {번호}` 또는 "PR {번호} 리뷰해줘"
- PR 머지: `/skill-merge-pr {번호}` 또는 "PR {번호} 머지해줘"

### 커밋 메시지 규칙
```
<type>: <description>

Types:
- feat: 새 기능
- fix: 버그 수정
- refactor: 리팩토링
- docs: 문서
- test: 테스트
- chore: 기타

예: feat: PG-GW-010 Step 1 - JWT 서비스 마이그레이션
```

---

## Task 개발 규칙

### 작업 ID 체계
```
PG-GW-{번호}

예: PG-GW-001, PG-GW-010
```

### 스텝 분리 기준
- 각 스텝은 **수정 라인 500라인 미만**으로 제한
- 세부 계획을 스텝 단위로 명확히 구분

### 라인 수 제한

| 라인 수 | 처리 |
|---------|------|
| < 300 | ✅ 양호 |
| 300~500 | ⚠️ 경고 (계속 진행 가능) |
| 500~700 | ⚠️ 강력 경고 (사용자 확인 필요) |
| > 700 | ❌ 차단 (반드시 스텝 분리) |

### 계획 파일 관리
```
.claude/temp/               # 임시 계획 파일 (Git 제외)
└── {taskId}-plan.md        # Task별 상세 계획
```

- **생성**: `/skill-plan` 실행 시 생성
- **참조**: `/skill-impl` 진행 중 반드시 참고
- **삭제**: 모든 스텝 완료 후 파일 삭제

---

## 코딩 컨벤션 (Kotlin + WebFlux)

### 기본 원칙
```kotlin
// val 우선, Null Safety
val token = jwtService.validateToken(accessToken)
    ?: throw GatewayException(GatewayErrorCode.TOKEN_INVALID)

// Reactive (WebFlux + Coroutines)
suspend fun authenticate(request: LoginRequest): LoginResponse {
    return authService.login(request).awaitSingle()
}

// Data Class
data class TokenResponse(
    val accessToken: String,
    val tokenType: String = "Bearer",
    val expiresIn: Long
)
```

### 패키지 구조
```
com.pg.gateway
├── api/              # Controller, DTO, Advice
├── application/      # Service, Port (inbound/outbound)
├── domain/           # Model, Enums, Exception
├── infrastructure/   # Filter, Cache, Security, RateLimit
├── config/           # Config, Properties
└── common/           # Constants, Util
```

### WebFlux 특화 규칙
```kotlin
// 블로킹 호출 금지 (block(), blockFirst())
// BAD
val result = mono.block()

// GOOD
val result = mono.awaitSingle()
```

---

## 보안 규칙

### JWT 보안
- 알고리즘: HMAC-SHA256 (HS256)
- 비밀키: 256bit 이상
- Access Token: 1시간 만료
- Refresh Token: 7일 만료
- Token Family 기반 세션 추적
- Token Reuse Detection 필수

### 로깅 보안
- 토큰 평문 로깅 **절대 금지**
- 비밀번호, API 키 로깅 **절대 금지**
- 민감정보 마스킹 필수

### Rate Limiting
- IP 기반: 100 req/분
- 사용자 기반: 1000 req/분
- 로그인 시도: 5회/5분

---

## 테스트 규칙

### 커버리지 목표
- 단위 테스트: 80%+
- 통합 테스트: 주요 플로우 100%

### 필수 테스트 항목
- JWT 토큰 발급/검증
- Token Rotation
- Token Reuse Detection
- Rate Limiting
- 헤더 전파 검증

### 성능 목표
- 응답시간 (P95): < 100ms
- 처리량: > 10,000 TPS
- 에러율: < 0.1%

---

## 에러 코드 체계

| 코드 | HTTP | 설명 |
|------|------|------|
| PG-GW-001 | 401 | TOKEN_MISSING |
| PG-GW-002 | 401 | TOKEN_INVALID_FORMAT |
| PG-GW-003 | 401 | TOKEN_EXPIRED |
| PG-GW-004 | 401 | TOKEN_INVALID_SIGNATURE |
| PG-GW-005 | 403 | ACCESS_DENIED |
| PG-GW-006 | 429 | RATE_LIMIT_EXCEEDED |
| PG-GW-007 | 503 | SERVICE_UNAVAILABLE |
| PG-GW-008 | 504 | GATEWAY_TIMEOUT |
| PG-GW-009 | 404 | ROUTE_NOT_FOUND |
| PG-GW-010 | 413 | PAYLOAD_TOO_LARGE |
| PG-GW-011 | 400 | INVALID_EMAIL_FORMAT |
| PG-GW-012 | 401 | INVALID_CREDENTIALS |
| PG-GW-013 | 403 | ACCOUNT_LOCKED |
| PG-GW-014 | 429 | LOGIN_ATTEMPTS_EXCEEDED |
| PG-GW-099 | 500 | INTERNAL_ERROR |

---

## 전파 헤더 목록

| 헤더 | 용도 |
|------|------|
| X-User-Id | 사용자 ID |
| X-User-Roles | 역할 목록 (쉼표 구분) |
| X-User-Email | 이메일 |
| X-Merchant-Mid | 가맹점 ID |
| X-Merchant-Filter | 가맹점 격리 플래그 |
| X-Gateway-Request | 게이트웨이 통과 표시 |
| X-Trace-Id | 분산 추적 ID |

---

## 포트 구성

| 서비스 | 포트 | 설명 |
|--------|------|------|
| pg-gateway | 10080 | API 게이트웨이 |
| payment-service | 10081 | 결제 서비스 (downstream) |
| settlement-service | 10082 | 정산 서비스 (downstream) |
| merchant-service | 10083 | 가맹점 서비스 (downstream) |
| prometheus | 19090 | 메트릭 수집 |
| grafana | 13030 | 대시보드 |

---

## 산출물 저장 위치

```
docs/
├── migration-plan.md     # 마이그레이션 계획
├── requirements/         # 요구사항 문서
├── api-specs/            # API 명세 (OpenAPI)
├── architecture/         # 아키텍처 문서
├── security/             # 보안 문서
└── test-plans/           # 테스트 계획

.claude/skills/skill-docs/
├── docs/                 # PG 시스템 참고자료
└── templates/            # 템플릿 (API, 테스트, 요구사항)
```

---

## 환경 설정

### 필수 환경변수
```bash
export JWT_SECRET_KEY="your-256-bit-secret-key-minimum-32-characters"
export SPRING_PROFILES_ACTIVE=local
```

### 실행
```bash
./gradlew bootRun
```

### 테스트
```bash
./gradlew test
```

---

## Playwright MCP 테스트 규칙

Playwright MCP를 사용하여 E2E 테스트 수행 시:

### 필수 설정
- **Headed 모드**: 항상 `headless: false`로 실행
- **브라우저**: Chrome (Chromium) 사용

### 실행 예시
```typescript
await mcp__playwright__browser_navigate({
  url: "http://localhost:10080/health",
  headless: false,
  browser: "chromium"
});
```

---

## Phase 별 작업 범위

| Phase | 제목 | 주요 작업 |
|-------|------|----------|
| 1 | 프로젝트 초기화 | build.gradle.kts, 패키지 구조, 기본 설정 |
| 2 | 핵심 기능 마이그레이션 | Domain, Service, Filter 마이그레이션 |
| 3 | 설정 및 보안 | SecurityConfig, 라우팅, Rate Limiter |
| 4 | 테스트 및 검증 | 단위/통합/성능/보안 테스트 |
| 5 | 운영 준비 | Docker, CI/CD, 모니터링, 문서화 |
| 6 | 권장 기능 (Redis) | Redis 분산 캐시, Rate Limiter, 대기열 |

---

## 충돌 처리

- **동시 /skill-plan**: push 충돌 -> pull 후 반드시 다른 task 선택
- **그 외**: 거의 발생 안 함 (순차 작업 시 Git이 자연스럽게 동기화)
