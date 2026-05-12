# 에러 처리 컨벤션

모든 프로젝트에 적용되는 에러 처리 규칙입니다.
도메인별 에러 코드 체계(PG 에러코드, 폴백 패턴 등)는 해당 도메인 문서를 참조하세요.

## 에러 코드 구조

```
{PREFIX}-{DOMAIN}-{NUMBER}
```

| 구성 | 설명 | 예시 |
|------|------|------|
| PREFIX | 서비스/모듈 식별자 | `AUTH`, `PAY`, `USR` |
| DOMAIN | 에러 도메인 | `AUTH`, `VALID`, `SYS` |
| NUMBER | 3자리 순번 | `001`, `002` |

예시: `AUTH-TOKEN-001` (인증 서비스, 토큰 도메인, 만료 에러)

## 공통 에러 응답 포맷

`api-design.md`의 에러 응답 포맷과 동일한 구조를 사용합니다:

```json
{
  "code": "USR-VALID-001",
  "message": "이메일 형식이 올바르지 않습니다",
  "detail": "email field must be a valid email address",
  "traceId": "abc-123-def",
  "timestamp": "2026-01-15T10:30:05Z"
}
```

## 예외 계층

```
ApplicationException (abstract)
├── BusinessException (4xx)
│   ├── NotFoundException (404)
│   ├── DuplicateException (409)
│   ├── ValidationException (400)
│   └── ForbiddenException (403)
└── SystemException (5xx)
    ├── ExternalServiceException (502/503)
    ├── DatabaseException (500)
    └── InternalException (500)
```

| 유형 | HTTP 상태 | 클라이언트 노출 | 알림 |
|------|----------|---------------|------|
| BusinessException | 4xx | 에러 코드 + 메시지 | ❌ |
| SystemException | 5xx | 일반 에러 메시지만 | ✅ 즉시 |

## HTTP 상태 코드 ↔ 비즈니스 예외 매핑

| 예외 | 상태 코드 | 의미 |
|------|----------|------|
| ValidationException | 400 | 입력값 검증 실패 |
| AuthenticationException | 401 | 인증 실패/만료 |
| ForbiddenException | 403 | 권한 없음 |
| NotFoundException | 404 | 리소스 없음 |
| DuplicateException | 409 | 중복 리소스 |
| BusinessRuleException | 422 | 비즈니스 규칙 위반 |
| RateLimitException | 429 | 요청 한도 초과 |
| ExternalServiceException | 502 | 외부 서비스 오류 |
| ServiceUnavailableException | 503 | 서비스 일시 중단 |

## 재시도 전략

### 기본 설정 (지수 백오프)

| 항목 | 기본값 |
|------|--------|
| 초기 대기 시간 | 100ms |
| 최대 대기 시간 | 10초 |
| 배수 (factor) | 2.0 |
| 최대 재시도 횟수 | 3회 |
| Jitter | ±20% |

```kotlin
// Spring Boot + Resilience4j 예시
@Retry(name = "externalService", fallbackMethod = "fallback")
fun callExternalService(request: Request): Response {
    return externalClient.call(request)
}

// application.yml
resilience4j:
  retry:
    instances:
      externalService:
        maxAttempts: 3
        waitDuration: 100ms
        enableExponentialBackoff: true
        exponentialBackoffMultiplier: 2.0
        retryExceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
```

### 재시도 대상 판별

| 대상 (재시도 O) | 비대상 (재시도 X) |
|----------------|------------------|
| 5xx 서버 에러 | 4xx 클라이언트 에러 |
| 네트워크 타임아웃 | 400 Bad Request |
| 429 Too Many Requests | 401 Unauthorized |
| Connection Refused | 403 Forbidden |
| | 404 Not Found |

## 서킷 브레이커

### 기본 설정

| 항목 | 기본값 |
|------|--------|
| 실패율 임계치 | 50% |
| 슬로우 콜 임계치 | 80% |
| 슬로우 콜 기준 시간 | 3초 |
| 슬라이딩 윈도우 크기 | 10회 |
| OPEN → HALF_OPEN 대기 | 60초 |
| HALF_OPEN 시 허용 요청 | 3회 |

### 상태 전이

```
CLOSED → (실패율 50% 초과) → OPEN → (60초 대기) → HALF_OPEN
                                                       ↓
                                            성공 → CLOSED
                                            실패 → OPEN
```

```yaml
# application.yml
resilience4j:
  circuitbreaker:
    instances:
      externalService:
        failureRateThreshold: 50
        slowCallRateThreshold: 80
        slowCallDurationThreshold: 3s
        slidingWindowSize: 10
        waitDurationInOpenState: 60s
        permittedNumberOfCallsInHalfOpenState: 3
```

## 클라이언트 노출 규칙

| 항목 | 규칙 |
|------|------|
| 에러 코드 | 항상 노출 |
| 사용자 메시지 | 항상 노출 (사용자 친화적) |
| 상세 정보 (detail) | 운영 환경에서 비노출 |
| 스택 트레이스 | **절대 비노출** |
| 내부 시스템 정보 | **절대 비노출** (DB명, 서버 IP 등) |

```kotlin
// GlobalExceptionHandler 예시
@RestControllerAdvice
class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException::class)
    fun handleBusiness(e: BusinessException): ResponseEntity<ErrorResponse> {
        return ResponseEntity.status(e.status).body(
            ErrorResponse(
                code = e.code,
                message = e.message,
                detail = if (isProd()) null else e.detail,
                traceId = MDC.get("traceId"),
                timestamp = Instant.now()
            )
        )
    }

    @ExceptionHandler(Exception::class)
    fun handleUnexpected(e: Exception): ResponseEntity<ErrorResponse> {
        logger.error("예상치 못한 에러", e)
        return ResponseEntity.status(500).body(
            ErrorResponse(
                code = "SYS-INTERNAL-001",
                message = "서버 내부 오류가 발생했습니다",
                traceId = MDC.get("traceId"),
                timestamp = Instant.now()
            )
        )
    }
}
```
