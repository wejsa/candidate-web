# 결제 연동

## 개요

이커머스 시스템의 결제 연동 아키텍처와 구현 패턴을 설명합니다.

## 결제 플로우

### 일반 결제

```
1. 주문서 작성 완료
2. 결제 수단 선택
3. PG사 결제창 호출
4. 결제 승인
5. 결제 결과 수신 (Webhook/Callback)
6. 주문 상태 업데이트
```

### 시퀀스 다이어그램

```
Client          Frontend        Backend         PG
  │                │               │            │
  │ 결제 요청      │               │            │
  ├───────────────>│               │            │
  │                │ 결제 준비     │            │
  │                ├──────────────>│            │
  │                │               │ 결제 키 발급│
  │                │               ├───────────>│
  │                │               │<───────────┤
  │                │<──────────────┤            │
  │ 결제창 표시    │               │            │
  │<───────────────┤               │            │
  │ 결제 진행      │               │            │
  ├─────────────────────────────────────────────>│
  │                │               │ 결제 완료   │
  │                │               │<───────────┤
  │                │<──────────────┤            │
  │<───────────────┤               │            │
```

## 결제 수단

| 수단 | 설명 | PG 연동 |
|------|------|--------|
| 카드 | 신용/체크카드 | 토스페이먼츠, 나이스 |
| 계좌이체 | 실시간 계좌이체 | 토스페이먼츠 |
| 가상계좌 | 무통장입금 | 토스페이먼츠 |
| 간편결제 | 카카오페이, 네이버페이 | 각 사 직접 연동 |
| 포인트 | 적립 포인트 | 자체 처리 |

## 결제 API 설계

### 결제 준비

```kotlin
@PostMapping("/payments/prepare")
suspend fun preparePayment(
    @RequestBody request: PaymentPrepareRequest
): PaymentPrepareResponse {
    // 1. 주문 정보 검증
    val order = orderService.findById(request.orderId)
        ?: throw OrderNotFoundException()

    // 2. 결제 금액 검증
    require(order.pricing.finalAmount == request.amount) {
        "결제 금액이 일치하지 않습니다"
    }

    // 3. PG 결제 준비
    val pgResponse = pgClient.prepare(
        orderId = order.id,
        amount = request.amount,
        orderName = generateOrderName(order),
        customerEmail = order.customer.email
    )

    // 4. 결제 정보 저장
    val payment = Payment(
        orderId = order.id,
        amount = request.amount,
        pgProvider = request.pgProvider,
        paymentKey = pgResponse.paymentKey,
        status = PaymentStatus.PENDING
    )
    paymentRepository.save(payment)

    return PaymentPrepareResponse(
        paymentKey = pgResponse.paymentKey,
        pgConfig = pgResponse.config
    )
}
```

### 결제 승인

```kotlin
@PostMapping("/payments/confirm")
suspend fun confirmPayment(
    @RequestBody request: PaymentConfirmRequest
): PaymentConfirmResponse {
    // 1. 결제 정보 조회
    val payment = paymentRepository.findByPaymentKey(request.paymentKey)
        ?: throw PaymentNotFoundException()

    // 2. PG 승인 요청
    val pgResult = pgClient.confirm(
        paymentKey = request.paymentKey,
        amount = request.amount,
        orderId = payment.orderId
    )

    // 3. 결제 결과 업데이트
    if (pgResult.status == "DONE") {
        payment.status = PaymentStatus.COMPLETED
        payment.approvalNumber = pgResult.approvalNumber
        payment.paidAt = Instant.now()

        // 주문 상태 업데이트
        orderService.markAsPaid(payment.orderId)
    } else {
        payment.status = PaymentStatus.FAILED
        payment.failReason = pgResult.failReason

        // 재고 예약 해제
        orderService.releaseReservation(payment.orderId)
    }

    paymentRepository.save(payment)

    return PaymentConfirmResponse(
        status = payment.status,
        orderId = payment.orderId
    )
}
```

### 결제 웹훅

```kotlin
@PostMapping("/webhooks/payment/{provider}")
suspend fun handlePaymentWebhook(
    @PathVariable provider: String,
    @RequestBody payload: String,
    @RequestHeader("X-Signature") signature: String
): ResponseEntity<Unit> {
    // 1. 서명 검증
    val isValid = webhookValidator.validate(provider, payload, signature)
    require(isValid) { "Invalid webhook signature" }

    // 2. 이벤트 처리
    val event = webhookParser.parse(provider, payload)
    when (event) {
        is PaymentCompleted -> paymentService.handleCompleted(event)
        is PaymentCancelled -> paymentService.handleCancelled(event)
        is VirtualAccountDeposited -> paymentService.handleDeposit(event)
    }

    return ResponseEntity.ok().build()
}
```

## 가상계좌 처리

### 발급 플로우

```
1. 결제 요청 (가상계좌)
2. 가상계좌 발급
3. 입금 대기 상태
4. 입금 확인 (Webhook)
5. 결제 완료
```

### 입금 처리

```kotlin
@Transactional
suspend fun handleVirtualAccountDeposit(event: VirtualAccountDeposited) {
    val payment = paymentRepository.findByPaymentKey(event.paymentKey)!!

    // 1. 금액 검증
    if (event.amount != payment.amount) {
        payment.status = PaymentStatus.PARTIAL
        // 부분 입금 처리 로직
        return
    }

    // 2. 결제 완료 처리
    payment.status = PaymentStatus.COMPLETED
    payment.paidAt = event.depositedAt

    // 3. 주문 처리
    orderService.markAsPaid(payment.orderId)

    paymentRepository.save(payment)
}
```

## 결제 취소

```kotlin
@PostMapping("/payments/{paymentId}/cancel")
suspend fun cancelPayment(
    @PathVariable paymentId: String,
    @RequestBody request: PaymentCancelRequest
): PaymentCancelResponse {
    val payment = paymentRepository.findById(paymentId)
        ?: throw PaymentNotFoundException()

    // 1. PG 취소 요청
    val cancelResult = pgClient.cancel(
        paymentKey = payment.paymentKey,
        cancelReason = request.reason,
        cancelAmount = request.amount ?: payment.amount
    )

    // 2. 결제 상태 업데이트
    if (request.amount == null || request.amount == payment.amount) {
        payment.status = PaymentStatus.CANCELLED
    } else {
        payment.status = PaymentStatus.PARTIAL_CANCELLED
        payment.cancelledAmount = (payment.cancelledAmount ?: BigDecimal.ZERO) + request.amount
    }

    // 3. 주문 처리
    if (payment.status == PaymentStatus.CANCELLED) {
        orderService.cancel(payment.orderId, request.reason)
    }

    return PaymentCancelResponse(
        status = payment.status,
        cancelledAmount = request.amount ?: payment.amount
    )
}
```

## PG사별 설정

```yaml
payment:
  providers:
    tosspayments:
      api-url: https://api.tosspayments.com
      client-key: ${TOSS_CLIENT_KEY}
      secret-key: ${TOSS_SECRET_KEY}
      webhook-secret: ${TOSS_WEBHOOK_SECRET}
    nicepay:
      api-url: https://api.nicepay.co.kr
      merchant-id: ${NICE_MERCHANT_ID}
      merchant-key: ${NICE_MERCHANT_KEY}
```

## 결제 데이터

```kotlin
data class Payment(
    val id: String,
    val orderId: String,
    val amount: BigDecimal,
    val pgProvider: String,
    val paymentMethod: PaymentMethod,
    val paymentKey: String,
    var status: PaymentStatus,
    var approvalNumber: String? = null,
    var paidAt: Instant? = null,
    var cancelledAmount: BigDecimal? = null,
    var failReason: String? = null,
    val createdAt: Instant
)

enum class PaymentStatus {
    PENDING,          // 결제 대기
    AWAITING_DEPOSIT, // 입금 대기 (가상계좌)
    COMPLETED,        // 결제 완료
    CANCELLED,        // 전체 취소
    PARTIAL_CANCELLED,// 부분 취소
    FAILED            // 실패
}
```

> **fintech 도메인 연동 시**: fintech PG Gateway와 연동하는 프로젝트에서는 결제 상태 매핑이 필요합니다.
> PENDING→INITIATED, COMPLETED→CAPTURED, CANCELLED→CANCELLED, FAILED→FAILED.
> 상세 결제 상태(AUTHORIZED/CAPTURED 분리)는 [fintech 도메인](../../fintech/docs/payment-flow.md)을 참조하세요.

## 참고사항

- PG사 결제창은 보안상 iframe이 아닌 리다이렉트 방식 권장
- 웹훅 서명 검증 필수
- 결제 금액은 서버에서 재검증
- 결제 실패 시 재고 예약 즉시 해제
