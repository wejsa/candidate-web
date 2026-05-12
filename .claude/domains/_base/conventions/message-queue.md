# 메시지 큐 컨벤션

모든 프로젝트에 적용되는 메시지 큐 사용 규칙입니다.
도메인별 이벤트 정의(결제 이벤트, 주문 이벤트 등)는 해당 도메인 문서를 참조하세요.

## 큐/토픽 네이밍

| 유형 | 패턴 | 예시 |
|------|------|------|
| 이벤트 토픽 | `{service}.{event}.{version}` | `payment.completed.v1` |
| 명령 큐 | `{service}.{command}.{version}` | `notification.send-email.v1` |
| DLQ | `{원본큐}.dlq` | `payment.completed.v1.dlq` |
| 재시도 큐 | `{원본큐}.retry.{n}` | `payment.completed.v1.retry.1` |

## 메시지 포맷 (CloudEvents 기반)

모든 메시지는 CloudEvents 표준을 따릅니다:

```json
{
  "id": "msg-abc-123",
  "source": "payment-service",
  "type": "payment.completed.v1",
  "time": "2026-02-19T10:30:05.123Z",
  "datacontenttype": "application/json",
  "data": {
    "paymentId": "PAY-001",
    "amount": 50000,
    "status": "COMPLETED"
  }
}
```

| 필드 | 설명 | 필수 |
|------|------|------|
| id | 메시지 고유 ID (UUID) | ✅ |
| source | 발행 서비스 | ✅ |
| type | 이벤트 타입 (네이밍 규칙 준수) | ✅ |
| time | 발행 시각 (ISO 8601, UTC) | ✅ |
| datacontenttype | 데이터 직렬화 형식 | ✅ |
| data | 이벤트 페이로드 | ✅ |

## 전달 보증

| 수준 | 패턴 | 사용 예시 |
|------|------|----------|
| At-least-once | ACK + 멱등성 | 결제 알림 (기본) |
| At-most-once | Auto-ACK | 로그 수집 |
| Exactly-once | Idempotency Key + 트랜잭션 | 금융 트랜잭션 |

## 멱등성

모든 컨슈머는 멱등하게 구현합니다:

```kotlin
// Idempotency Key 기반 중복 처리 방지
@Transactional
fun handlePaymentCompleted(event: PaymentCompletedEvent) {
    val messageId = event.id
    if (processedMessageRepository.existsById(messageId)) {
        logger.info("이미 처리된 메시지: messageId={}", messageId)
        return
    }
    orderService.completeOrder(event.data.orderId)
    processedMessageRepository.save(ProcessedMessage(id = messageId, processedAt = Instant.now()))
}
```

```typescript
// Idempotency Key 기반 중복 처리 방지
async function handlePaymentCompleted(event: PaymentCompletedEvent): Promise<void> {
  const messageId = event.id;
  const exists = await processedMessageRepo.findById(messageId);
  if (exists) {
    logger.info('이미 처리된 메시지', { messageId });
    return;
  }
  await orderService.completeOrder(event.data.orderId);
  await processedMessageRepo.save({ id: messageId, processedAt: new Date() });
}
```

## 재시도 전략

| 항목 | 기본값 |
|------|--------|
| 백오프 방식 | 지수 백오프 (1초 → 2초 → 4초) |
| 최대 재시도 | 3~5회 |
| Jitter | ±20% |
| 최종 실패 | DLQ로 이동 |

```kotlin
// Spring Boot + RabbitMQ 재시도 설정
@Configuration
class RabbitConfig {
    @Bean
    fun retryInterceptor(): RetryOperationsInterceptor {
        return RetryInterceptorBuilder.stateless()
            .maxAttempts(3)
            .backOffOptions(1000, 2.0, 10000) // initial, multiplier, max
            .recoverer(RejectAndDontRequeueRecoverer()) // DLQ로 이동
            .build()
    }
}
```

## DLQ (Dead Letter Queue)

| 규칙 | 설명 |
|------|------|
| DLQ 매핑 필수 | 모든 큐에 DLQ 연결 |
| 모니터링 알림 | DLQ 메시지 유입 시 Warning 알림 |
| 수동 재처리 | 원인 분석 후 수동 재투입 도구 제공 |
| 보존 기간 | 최소 7일 (원인 분석 시간 확보) |

```typescript
// RabbitMQ DLQ 설정 (amqplib)
const channel = await connection.createChannel();

// DLQ 선언
await channel.assertQueue('payment.completed.v1.dlq', { durable: true });

// 메인 큐 (DLQ 연결)
await channel.assertQueue('payment.completed.v1', {
  durable: true,
  arguments: {
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': 'payment.completed.v1.dlq',
  },
});
```

## 메시지 순서

| 규칙 | 설명 |
|------|------|
| 파티션 키 | 동일 엔티티 이벤트는 같은 파티션으로 라우팅 |
| 전역 순서 지양 | 전역 순서 보장은 성능 저하 유발 |
| 순서 보장 범위 | 파티션/큐 단위로만 보장 |

## 컨슈머 설계

| 원칙 | 설명 |
|------|------|
| 단일 책임 | 하나의 컨슈머 = 하나의 처리 |
| 처리 시간 제한 | timeout 설정 (기본 30초) |
| 수평 확장 | 컨슈머 그룹 기반 스케일 아웃 |
| 독립 배포 | 프로듀서와 컨슈머 독립 배포 가능해야 함 |

## 이벤트 버전 관리

| 규칙 | 설명 |
|------|------|
| 하위 호환 | 새 필드 추가는 optional로 |
| 버전 접미사 | 호환 불가 변경 시 `v2` 신규 토픽 생성 |
| 동시 운영 | 전환 기간 동안 `v1`, `v2` 동시 발행 |
| 폐기 절차 | 모든 컨슈머 전환 확인 후 이전 버전 폐기 |

```kotlin
// 이벤트 발행 (Spring Boot + AMQP)
@Service
class PaymentEventPublisher(private val rabbitTemplate: RabbitTemplate) {

    fun publishPaymentCompleted(payment: Payment) {
        val event = CloudEvent(
            id = UUID.randomUUID().toString(),
            source = "payment-service",
            type = "payment.completed.v1",
            time = Instant.now(),
            data = PaymentCompletedData(
                paymentId = payment.id,
                amount = payment.amount,
                status = payment.status.name
            )
        )
        rabbitTemplate.convertAndSend("payment.completed.v1", objectMapper.writeValueAsString(event))
        logger.info("이벤트 발행: type={}, paymentId={}", event.type, payment.id)
    }
}
```
