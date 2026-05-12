# 에러 처리

## 개요

금융 서비스의 에러 처리 전략과 재시도 로직을 설명합니다.

## 에러 코드 체계

### 코드 구조

```
{PREFIX}-{DOMAIN}-{NUMBER}

예: PG-GW-001
    │   │    │
    │   │    └── 일련번호 (001-099)
    │   └────── 도메인 (GW: Gateway)
    └────────── 프로젝트 접두사
```

### 에러 코드 분류

| 범위 | 분류 | 설명 |
|------|------|------|
| 001-019 | 인증/토큰 | 인증 관련 오류 |
| 020-039 | 권한/접근 | 인가 관련 오류 |
| 040-059 | 결제/거래 | 결제 처리 오류 |
| 060-079 | 정산 | 정산 처리 오류 |
| 080-089 | 외부 연동 | PG/VAN 연동 오류 |
| 090-099 | 시스템 | 내부 시스템 오류 |

### 주요 에러 코드

| 코드 | HTTP | 설명 |
|------|------|------|
| PG-GW-001 | 401 | TOKEN_MISSING |
| PG-GW-002 | 401 | TOKEN_INVALID_FORMAT |
| PG-GW-003 | 401 | TOKEN_EXPIRED |
| PG-GW-004 | 401 | TOKEN_INVALID_SIGNATURE |
| PG-GW-005 | 403 | ACCESS_DENIED |
| PG-GW-006 | 429 | RATE_LIMIT_EXCEEDED |
| PG-GW-012 | 401 | INVALID_CREDENTIALS |
| PG-GW-016 | 401 | TOKEN_REUSED |
| PG-GW-007 | 503 | SERVICE_UNAVAILABLE |
| PG-GW-008 | 504 | GATEWAY_TIMEOUT |
| PG-GW-041 | 400 | INVALID_AMOUNT |
| PG-GW-042 | 400 | INVALID_CARD_NUMBER |
| PG-GW-043 | 409 | DUPLICATE_TRANSACTION |
| PG-GW-044 | 422 | ALREADY_CANCELLED |
| PG-GW-081 | 502 | PG_CONNECTION_ERROR |
| PG-GW-082 | 504 | PG_TIMEOUT |
| PG-GW-099 | 500 | INTERNAL_ERROR |

## 에러 응답 형식

### 표준 응답

```json
{
  "error": {
    "code": "PG-GW-003",
    "message": "토큰이 만료되었습니다",
    "detail": "Access token has expired. Please refresh.",
    "timestamp": "2026-01-01T12:00:00Z",
    "traceId": "abc-123-def-456"
  }
}
```

### 검증 오류

```json
{
  "error": {
    "code": "PG-GW-041",
    "message": "유효하지 않은 결제 금액입니다",
    "detail": "Amount must be greater than 0",
    "fields": [
      {
        "field": "amount",
        "value": "-1000",
        "reason": "must be positive"
      }
    ],
    "timestamp": "2026-01-01T12:00:00Z",
    "traceId": "abc-123-def-456"
  }
}
```

## 예외 계층 구조

```kotlin
sealed class GatewayException(
    val errorCode: GatewayErrorCode,
    override val message: String
) : RuntimeException(message) {

    class AuthenticationException(
        errorCode: GatewayErrorCode,
        message: String
    ) : GatewayException(errorCode, message)

    class AuthorizationException(
        errorCode: GatewayErrorCode,
        message: String
    ) : GatewayException(errorCode, message)

    class PaymentException(
        errorCode: GatewayErrorCode,
        message: String,
        val transactionId: String? = null
    ) : GatewayException(errorCode, message)

    class ExternalServiceException(
        errorCode: GatewayErrorCode,
        message: String,
        val serviceName: String
    ) : GatewayException(errorCode, message)
}
```

## 재시도 전략

### 재시도 가능 여부

| 상태 | 재시도 | 사유 |
|------|--------|------|
| 네트워크 타임아웃 | ✅ | 일시적 장애 |
| 503 Service Unavailable | ✅ | 일시적 과부하 |
| 502 Bad Gateway | ✅ | 업스트림 오류 |
| 429 Too Many Requests | ✅ | 딜레이 후 재시도 |
| 400 Bad Request | ❌ | 요청 오류 |
| 401/403 | ❌ | 인증/인가 오류 |
| 500 Internal Error | ⚠️ | 케이스별 판단 |

### Exponential Backoff

```kotlin
suspend fun <T> retryWithBackoff(
    maxAttempts: Int = 3,
    initialDelay: Duration = 100.milliseconds,
    maxDelay: Duration = 10.seconds,
    factor: Double = 2.0,
    block: suspend () -> T
): T {
    var currentDelay = initialDelay
    var attempt = 1

    while (true) {
        try {
            return block()
        } catch (e: RetryableException) {
            if (attempt >= maxAttempts) throw e

            delay(currentDelay)
            currentDelay = minOf(currentDelay * factor, maxDelay)
            attempt++

            logger.warn("Retry attempt $attempt after ${currentDelay}")
        }
    }
}
```

### 재시도 설정

```yaml
resilience:
  retry:
    max-attempts: 3
    initial-delay: 100ms
    max-delay: 10s
    multiplier: 2.0
    retry-exceptions:
      - java.net.SocketTimeoutException
      - java.net.ConnectException
      - org.springframework.web.reactive.function.client.WebClientRequestException
```

## Circuit Breaker

### 상태 전이

```
CLOSED → (실패율 초과) → OPEN → (대기 시간 후) → HALF_OPEN
   ↑                                              │
   └───────── (성공) ────────────────────────────┘
                     │
                     └── (실패) → OPEN
```

### 설정

```kotlin
@Bean
fun circuitBreakerConfig(): CircuitBreakerConfig {
    return CircuitBreakerConfig.custom()
        .failureRateThreshold(50f)           // 실패율 50% 초과 시 OPEN
        .slowCallRateThreshold(80f)          // 느린 호출 80% 초과 시 OPEN
        .slowCallDurationThreshold(Duration.ofSeconds(2))
        .waitDurationInOpenState(Duration.ofSeconds(30))
        .permittedNumberOfCallsInHalfOpenState(5)
        .slidingWindowType(SlidingWindowType.COUNT_BASED)
        .slidingWindowSize(10)
        .build()
}
```

## Fallback 처리

### 패턴

```kotlin
suspend fun processPayment(request: PaymentRequest): PaymentResponse {
    return try {
        primaryPgClient.process(request)
    } catch (e: PrimaryPgException) {
        logger.warn("Primary PG failed, trying secondary", e)
        try {
            secondaryPgClient.process(request)
        } catch (e2: SecondaryPgException) {
            logger.error("All PG failed", e2)
            throw PaymentException(
                GatewayErrorCode.PG_CONNECTION_ERROR,
                "결제 처리에 실패했습니다"
            )
        }
    }
}
```

## 로깅 가이드

### 에러 로깅

```kotlin
// ✅ 좋은 예
logger.error(
    "Payment failed: code={}, transactionId={}, traceId={}",
    errorCode, transactionId, traceId, exception
)

// ❌ 나쁜 예
logger.error("Payment failed: $request")  // 민감정보 노출 위험
```

### 로그 레벨

| 상황 | 레벨 |
|------|------|
| 사용자 입력 오류 | WARN |
| 재시도 후 성공 | INFO |
| 재시도 후 실패 | ERROR |
| 시스템 장애 | ERROR |
| 디버깅 정보 | DEBUG |
