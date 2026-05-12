# API 설계 가이드

## 개요

금융 API 설계의 핵심 원칙과 패턴을 설명합니다.

## RESTful 설계 원칙

### URL 구조

```
/{버전}/{리소스}/{ID}/{하위리소스}

예:
/v1/payments/{paymentId}
/v1/merchants/{merchantId}/transactions
/v1/settlements/{settlementId}/details
```

### HTTP 메서드

| 메서드 | 용도 | 멱등성 |
|--------|------|--------|
| GET | 조회 | ✅ |
| POST | 생성 | ❌ |
| PUT | 전체 수정 | ✅ |
| PATCH | 부분 수정 | ❌ |
| DELETE | 삭제 | ✅ |

### 상태 코드

| 코드 | 의미 | 사용 |
|------|------|------|
| 200 | OK | 성공 (조회, 수정) |
| 201 | Created | 생성 성공 |
| 204 | No Content | 삭제 성공 |
| 400 | Bad Request | 잘못된 요청 |
| 401 | Unauthorized | 인증 필요 |
| 403 | Forbidden | 권한 없음 |
| 404 | Not Found | 리소스 없음 |
| 409 | Conflict | 충돌 (중복) |
| 422 | Unprocessable | 처리 불가 |
| 429 | Too Many Requests | 요청 제한 |
| 500 | Internal Error | 서버 오류 |

## 멱등성 (Idempotency)

### 개념

```
동일한 요청을 여러 번 보내도 결과가 동일해야 함
```

### 구현 방법

#### 1. Idempotency Key

```http
POST /v1/payments
Idempotency-Key: order-12345-payment-1
Content-Type: application/json

{
  "amount": 10000,
  "merchantId": "MID001"
}
```

#### 2. 서버 처리

```kotlin
@Service
class IdempotencyService(
    private val cache: ReactiveRedisTemplate<String, String>
) {
    suspend fun <T> executeIdempotent(
        key: String,
        ttl: Duration = Duration.ofHours(24),
        block: suspend () -> T
    ): T {
        // 1. 기존 결과 확인
        val cached = cache.opsForValue().get(key).awaitFirstOrNull()
        if (cached != null) {
            return deserialize(cached)
        }

        // 2. 처리 중 표시 (중복 요청 방지)
        val acquired = cache.opsForValue()
            .setIfAbsent(key, "PROCESSING", ttl)
            .awaitFirst()

        if (!acquired) {
            throw ConflictException("Request is being processed")
        }

        // 3. 실제 처리
        val result = block()

        // 4. 결과 저장
        cache.opsForValue().set(key, serialize(result), ttl).awaitFirst()

        return result
    }
}
```

### 멱등성 키 설계

| 리소스 | 키 형식 | 예시 |
|--------|--------|------|
| 결제 | `{merchantId}-{orderId}` | `MID001-ORD12345` |
| 취소 | `{transactionId}-cancel` | `TXN123-cancel` |
| 환불 | `{transactionId}-refund-{amount}` | `TXN123-refund-5000` |

## 페이지네이션

### Cursor 기반 (권장)

```http
GET /v1/transactions?cursor=abc123&limit=20
```

```json
{
  "data": [...],
  "pagination": {
    "cursor": "xyz789",
    "hasMore": true,
    "limit": 20
  }
}
```

### Offset 기반

```http
GET /v1/transactions?page=1&size=20
```

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "size": 20,
    "totalPages": 10,
    "totalElements": 195
  }
}
```

## 버전 관리

### URL 버전

```
/v1/payments
/v2/payments
```

### 헤더 버전 (대안)

```http
Accept: application/vnd.pg-gateway.v1+json
```

### 버전 정책

| 변경 유형 | 버전 | 예시 |
|----------|------|------|
| 필드 추가 | 유지 | 응답에 새 필드 추가 |
| 필드 제거 | 신규 버전 | 기존 필드 제거 |
| 타입 변경 | 신규 버전 | string → number |
| URL 변경 | 신규 버전 | 경로 구조 변경 |

## 웹훅 (Webhook)

### 이벤트 유형

| 이벤트 | 설명 |
|--------|------|
| `payment.authorized` | 결제 승인 |
| `payment.captured` | 매입 완료 |
| `payment.cancelled` | 결제 취소 |
| `refund.completed` | 환불 완료 |
| `settlement.completed` | 정산 완료 |

### 웹훅 페이로드

```json
{
  "id": "evt_12345",
  "type": "payment.authorized",
  "createdAt": "2026-01-01T12:00:00Z",
  "data": {
    "transactionId": "TXN12345",
    "amount": 10000,
    "status": "AUTHORIZED"
  },
  "signature": "sha256=abc123..."
}
```

### 서명 검증

```kotlin
fun verifyWebhookSignature(
    payload: String,
    signature: String,
    secret: String
): Boolean {
    val expected = "sha256=" + HmacUtils.hmacSha256Hex(secret, payload)
    return MessageDigest.isEqual(
        expected.toByteArray(),
        signature.toByteArray()
    )
}
```

### 재시도 정책

| 시도 | 대기 시간 |
|------|----------|
| 1차 | 즉시 |
| 2차 | 1분 |
| 3차 | 5분 |
| 4차 | 30분 |
| 5차 | 2시간 |

## 요청/응답 형식

### 요청 예시

```http
POST /v1/payments HTTP/1.1
Host: api.pg-gateway.com
Authorization: Bearer eyJ...
Idempotency-Key: order-12345
Content-Type: application/json

{
  "merchantId": "MID001",
  "orderId": "ORD12345",
  "amount": 10000,
  "currency": "KRW",
  "paymentMethod": {
    "type": "CARD",
    "cardNumber": "encrypted...",
    "expiryMonth": "12",
    "expiryYear": "26"
  },
  "metadata": {
    "productName": "상품명"
  }
}
```

### 응답 예시

```json
{
  "transactionId": "TXN202601010001",
  "status": "AUTHORIZED",
  "amount": 10000,
  "currency": "KRW",
  "approvalNumber": "12345678",
  "authorizedAt": "2026-01-01T12:00:00Z",
  "merchantId": "MID001",
  "orderId": "ORD12345"
}
```

## Rate Limiting

### 정책

| 대상 | 제한 | 헤더 |
|------|------|------|
| IP | 100 req/분 | X-RateLimit-IP |
| 사용자 | 1000 req/분 | X-RateLimit-User |
| 가맹점 | 10000 req/분 | X-RateLimit-Merchant |

### 응답 헤더

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704067260
```

### 초과 시 응답

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30

{
  "error": {
    "code": "PG-GW-006",
    "message": "요청 한도를 초과했습니다",
    "retryAfter": 30
  }
}
```
