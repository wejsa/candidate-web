# 주문 플로우

## 개요

이커머스 주문의 전체 라이프사이클을 설명합니다.

## 주문 상태 머신

> 장바구니(CART)는 주문과 별도 도메인으로 관리합니다. 주문은 CHECKOUT 상태에서 시작합니다.

> 결제 대기(PAYMENT_PENDING/AWAITING_DEPOSIT)는 Payment 엔티티의 상태로 관리하며, 주문<->결제 상태 매핑은 아래 섹션을 참조하세요.

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  CHECKOUT ──→ PAID ──→ PREPARING ──→ READY_TO_SHIP ──→ SHIPPING    │
│     │           │          │               │                │       │
│     ▼           ▼          ▼               ▼                ▼       │
│  CANCELLED  CANCEL_REQ  CANCEL_REQ    CANCEL_REQ        DELIVERED   │
│                 │                                           │       │
│                 ▼                                           ▼       │
│             CANCELLED / PREPARING(거부)          CONFIRMED / RETURN_REQ │
│                                                            │       │
│                                                            ▼       │
│                                                  RETURNING / DELIVERED(거부) │
│                                                      │              │
│                                                      ▼              │
│                                                  RETURNED           │
│                                                      │              │
│                                                      ▼              │
│                                                  REFUNDED           │
└─────────────────────────────────────────────────────────────────────┘
```

### 상태 정의

| 상태 | 설명 | 다음 상태 |
|------|------|----------|
| CHECKOUT | 주문서 작성 중 | PAID, CANCELLED |
| PAID | 결제 완료 | PREPARING, CANCEL_REQUESTED |
| PREPARING | 상품 준비 중 | READY_TO_SHIP, CANCEL_REQUESTED |
| READY_TO_SHIP | 발송 준비 완료 | SHIPPING, CANCEL_REQUESTED |
| SHIPPING | 배송 중 | DELIVERED |
| DELIVERED | 배송 완료 | CONFIRMED, RETURN_REQUESTED |
| CONFIRMED | 구매 확정 | - |
| CANCEL_REQUESTED | 취소 요청 (셀러 확인 대기) | CANCELLED, PREPARING |
| CANCELLED | 취소 완료 | - |
| RETURN_REQUESTED | 반품 요청 | RETURNING, DELIVERED |
| RETURNING | 반품 진행 중 | RETURNED |
| RETURNED | 반품 완료 | REFUNDED |
| REFUNDED | 환불 완료 | - |

### 허용 전이

| From | To | 조건 |
|------|-----|------|
| CHECKOUT | PAID | 결제 성공 |
| CHECKOUT | CANCELLED | 주문 취소 (결제 전) |
| PAID | PREPARING | 결제 확인 후 상품 준비 |
| PAID | CANCEL_REQUESTED | 취소 요청 (결제 후) |
| PREPARING | READY_TO_SHIP | 포장 완료 |
| PREPARING | CANCEL_REQUESTED | 취소 요청 (발송 전) |
| READY_TO_SHIP | SHIPPING | 택배사 인수 |
| READY_TO_SHIP | CANCEL_REQUESTED | 취소 요청 (발송 전) |
| CANCEL_REQUESTED | CANCELLED | 취소 승인 + 결제 취소 + 재고 복원 |
| CANCEL_REQUESTED | PREPARING | 취소 거부 (셀러) |
| SHIPPING | DELIVERED | 배송 완료 확인 |
| DELIVERED | CONFIRMED | 구매 확정 (자동/수동) |
| DELIVERED | RETURN_REQUESTED | 반품 요청 |
| RETURN_REQUESTED | RETURNING | 반품 승인 |
| RETURN_REQUESTED | DELIVERED | 반품 거부 |
| RETURNING | RETURNED | 반품 수거 완료 |
| RETURNED | REFUNDED | 환불 처리 완료 |

## 주문<->결제 상태 매핑

| 결제 상태 (Payment) | 주문 상태 (Order) | 설명 |
|---------------------|-------------------|------|
| PENDING | CHECKOUT | 결제 진행 전 |
| AWAITING_DEPOSIT | CHECKOUT | 가상계좌 입금 대기 |
| COMPLETED | PAID | 결제 성공 -> 주문 확정 |
| FAILED | CANCELLED | 결제 실패 -> 주문 취소 + 재고 해제 |
| CANCELLED | CANCELLED | 결제 취소 -> 주문 취소 |
| PARTIAL_CANCELLED | (변경 없음) | 부분 환불 -- 주문 상태 유지 |

> 결제 상태는 [payment-integration.md](payment-integration.md)에서 관리합니다.

## 주문 생성 플로우

### 1. 장바구니 → 주문서

```kotlin
@Transactional
suspend fun createOrder(cartId: String, userId: String): Order {
    // 1. 장바구니 조회
    val cart = cartService.getCart(cartId)

    // 2. 재고 확인 및 예약
    val reservations = cart.items.map { item ->
        inventoryService.reserve(item.productId, item.quantity)
    }

    // 3. 주문 생성
    val order = Order(
        userId = userId,
        items = cart.items.map { it.toOrderItem() },
        status = OrderStatus.CHECKOUT,
        reservations = reservations
    )

    // 4. 가격 계산 (할인 적용)
    val pricing = pricingService.calculate(order)

    return orderRepository.save(order.copy(pricing = pricing))
}
```

### 2. 결제 처리

```kotlin
@Transactional
suspend fun processPayment(orderId: String, paymentInfo: PaymentInfo): Order {
    val order = orderRepository.findById(orderId)
        ?: throw OrderNotFoundException()

    // 1. 결제 요청
    val paymentResult = paymentService.process(
        orderId = orderId,
        amount = order.pricing.finalAmount,
        paymentInfo = paymentInfo
    )

    // 2. 결제 성공 시 상태 변경
    if (paymentResult.success) {
        order.status = OrderStatus.PAID
        // 재고 예약 → 확정
        inventoryService.confirm(order.reservations)
    } else {
        order.status = OrderStatus.CANCELLED
        // 재고 예약 해제
        inventoryService.release(order.reservations)
    }

    return orderRepository.save(order)
}
```

## 주문 취소

### 취소 가능 조건

| 상태 | 취소 가능 | 처리 |
|------|----------|------|
| CHECKOUT | 즉시 취소 | 예약 해제 |
| PAID | CANCEL_REQUESTED | 취소 요청 → 셀러 승인 후 결제 취소 + 재고 복원 |
| PREPARING | CANCEL_REQUESTED | 취소 요청 → 셀러 승인 후 결제 취소 + 재고 복원 |
| READY_TO_SHIP | CANCEL_REQUESTED | 취소 요청 → 셀러 승인 후 결제 취소 + 재고 복원 |
| SHIPPING | 취소 불가 | 반품으로 처리 |
| DELIVERED | 취소 불가 | 반품으로 처리 |

### 취소 처리

```kotlin
@Transactional
suspend fun cancelOrder(orderId: String, reason: String): Order {
    val order = orderRepository.findById(orderId)
        ?: throw OrderNotFoundException()

    require(order.canCancel()) { "취소할 수 없는 주문 상태입니다" }

    // 1. 결제 취소 (결제 완료 상태인 경우)
    if (order.status == OrderStatus.PAID) {
        paymentService.cancel(order.paymentId)
    }

    // 2. 재고 복원
    inventoryService.restore(order.items)

    // 3. 상태 변경
    order.status = OrderStatus.CANCELLED
    order.cancelledAt = Instant.now()
    order.cancelReason = reason

    return orderRepository.save(order)
}
```

## 주문 항목 구조

```kotlin
data class Order(
    val id: String,
    val userId: String,
    val items: List<OrderItem>,
    val shippingAddress: Address,
    val pricing: OrderPricing,
    var status: OrderStatus,
    val createdAt: Instant,
    var paidAt: Instant? = null,
    var shippedAt: Instant? = null,
    var deliveredAt: Instant? = null
)

data class OrderItem(
    val productId: String,
    val productName: String,
    val optionId: String?,
    val quantity: Int,
    val unitPrice: BigDecimal,
    val totalPrice: BigDecimal
)

data class OrderPricing(
    val itemsTotal: BigDecimal,
    val shippingFee: BigDecimal,
    val discountAmount: BigDecimal,
    val couponDiscount: BigDecimal,
    val finalAmount: BigDecimal
)
```

## 이벤트 발행

주문 상태 변경 시 이벤트 발행:

```kotlin
sealed class OrderEvent {
    data class Created(val order: Order) : OrderEvent()
    data class Paid(val orderId: String, val paidAt: Instant) : OrderEvent()
    data class Shipped(val orderId: String, val trackingNumber: String) : OrderEvent()
    data class Delivered(val orderId: String) : OrderEvent()
    data class Cancelled(val orderId: String, val reason: String) : OrderEvent()
}
```

## 참고사항

- 재고 예약 → 확정 2단계 처리로 동시성 이슈 방지
- 결제 실패 시 반드시 예약 해제
- 주문 취소 시 결제 취소 먼저 처리
- 모든 상태 변경에 이력 기록
