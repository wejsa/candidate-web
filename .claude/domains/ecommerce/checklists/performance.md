# 성능 체크리스트

이커머스 대용량 트래픽 처리 성능 체크리스트입니다.

## 데이터베이스

| 항목 | 설명 | 심각도 |
|------|------|--------|
| N+1 쿼리 방지 | Fetch Join 또는 Batch 조회 사용 | CRITICAL |
| 인덱스 설계 | 자주 조회되는 컬럼에 인덱스 | MAJOR |
| 페이지네이션 | Offset 대신 Cursor 기반 권장 | MAJOR |
| 읽기/쓰기 분리 | 읽기 트래픽 Replica로 분산 | MAJOR |
| 커넥션 풀 | 적절한 커넥션 풀 사이즈 | MAJOR |

### N+1 방지 패턴

```kotlin
// ❌ N+1 문제
orders.forEach { order ->
    val items = itemRepository.findByOrderId(order.id)  // N번 쿼리
}

// ✅ Fetch Join
@Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.userId = :userId")
fun findByUserIdWithItems(userId: String): List<Order>

// ✅ BatchSize
@BatchSize(size = 100)
@OneToMany
val items: List<OrderItem>
```

## 캐싱

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 상품 정보 캐시 | 자주 조회되는 상품 정보 캐싱 | MAJOR |
| 카테고리 캐시 | 카테고리 트리 캐싱 | MINOR |
| 재고 캐시 | 가용 재고 캐시 (짧은 TTL) | MAJOR |
| 캐시 무효화 | 데이터 변경 시 캐시 갱신 | CRITICAL |
| 캐시 스탬피드 | 동시 만료 시 요청 폭주 방지 | MAJOR |

### 캐싱 전략

```kotlin
// 읽기 캐시 (Look-aside)
suspend fun getProduct(id: String): Product {
    return cache.get(id) ?: run {
        val product = productRepository.findById(id)
        cache.put(id, product, ttl = 5.minutes)
        product
    }
}

// 쓰기 시 캐시 무효화
@Transactional
suspend fun updateProduct(id: String, request: UpdateRequest): Product {
    val product = productRepository.save(...)
    cache.evict(id)  // 캐시 무효화
    return product
}
```

## 비동기 처리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 이메일 발송 | 비동기 처리 (메시지 큐) | MAJOR |
| 알림 발송 | 비동기 처리 | MAJOR |
| 로그 기록 | 비동기 처리 | MINOR |
| 이벤트 발행 | 메시지 큐 사용 | MAJOR |

### 비동기 패턴

```kotlin
// ✅ 이벤트 기반 비동기
@EventListener
@Async
fun handleOrderCreated(event: OrderCreatedEvent) {
    emailService.sendOrderConfirmation(event.order)
    notificationService.sendPush(event.userId)
}

// ✅ 메시지 큐 사용
rabbitTemplate.convertAndSend("order-events", orderCreatedEvent)
```

## API 최적화

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 응답 크기 | 필요한 필드만 반환 | MINOR |
| 압축 | gzip 압축 활성화 | MINOR |
| 페이지 크기 | 적절한 페이지 크기 (20-50) | MINOR |
| 검색 최적화 | Elasticsearch 등 검색 엔진 활용 | MAJOR |

## 고가용성

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 타임아웃 설정 | 외부 호출 타임아웃 필수 | CRITICAL |
| Circuit Breaker | 연속 실패 시 요청 차단 | MAJOR |
| 재시도 로직 | 일시적 오류 자동 재시도 | MAJOR |
| Fallback | 장애 시 대체 응답 | MAJOR |
| Rate Limiting | 과도한 요청 제한 | MAJOR |

### Circuit Breaker 패턴

```kotlin
@CircuitBreaker(name = "paymentService", fallbackMethod = "paymentFallback")
suspend fun processPayment(request: PaymentRequest): PaymentResponse {
    return paymentClient.process(request)
}

suspend fun paymentFallback(request: PaymentRequest, ex: Exception): PaymentResponse {
    logger.error("Payment service unavailable", ex)
    throw PaymentTemporaryException("잠시 후 다시 시도해주세요")
}
```

## 트래픽 급증 대응

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 대기열 시스템 | 선착순 이벤트 시 대기열 | MAJOR |
| 재고 사전 캐싱 | 이벤트 전 재고 캐시 | MAJOR |
| DB 쓰기 분산 | 쓰기 작업 큐잉 | MAJOR |
| 정적 리소스 CDN | 이미지, JS, CSS CDN 배포 | MINOR |

### 대기열 패턴

```kotlin
// 선착순 이벤트 대기열
suspend fun joinQueue(userId: String, eventId: String): QueuePosition {
    val position = redis.zAdd(
        "event:$eventId:queue",
        System.currentTimeMillis().toDouble(),
        userId
    )
    return QueuePosition(position)
}

suspend fun processQueue(eventId: String) {
    val users = redis.zRange("event:$eventId:queue", 0, BATCH_SIZE)
    users.forEach { userId ->
        orderService.createEventOrder(userId, eventId)
        redis.zRem("event:$eventId:queue", userId)
    }
}
```

## 모니터링

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 응답 시간 | P95 < 500ms | MAJOR |
| 에러율 | < 0.1% | MAJOR |
| DB 쿼리 | 슬로우 쿼리 모니터링 | MAJOR |
| 캐시 적중률 | > 90% | MINOR |

## 사용 방법

이 체크리스트는 성능 관점 코드 리뷰 시 적용됩니다.
대규모 트래픽 예상 시 반드시 확인하세요.
