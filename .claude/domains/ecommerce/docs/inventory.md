# 재고 관리

## 개요

상품 재고 관리 시스템의 핵심 개념과 구현 패턴을 설명합니다.

## 재고 유형

| 유형 | 설명 | 계산 |
|------|------|------|
| 물리 재고 | 실제 창고 보유량 | 입고 - 출고 |
| 가용 재고 | 판매 가능량 | 물리 재고 - 예약 재고 |
| 예약 재고 | 주문 확정 대기 | 장바구니/주문 수량 |
| 안전 재고 | 최소 유지량 | 설정값 |

## 재고 수량 관리

```kotlin
data class Inventory(
    val productId: String,
    val warehouseId: String,
    var physicalStock: Int,      // 물리 재고
    var reservedStock: Int,      // 예약 재고
    var safetyStock: Int,        // 안전 재고
    @Version var version: Long   // 낙관적 락
) {
    val availableStock: Int
        get() = physicalStock - reservedStock

    fun canSell(quantity: Int): Boolean =
        availableStock >= quantity
}
```

## 재고 변동 유형

| 유형 | 동작 | 트리거 |
|------|------|--------|
| RESERVE | 예약 증가 | 주문 생성 |
| RELEASE | 예약 감소 | 주문 취소 |
| CONFIRM | 예약→출고 | 결제 완료 |
| RECEIVE | 입고 | 입고 처리 |
| SHIP | 출고 | 배송 시작 |
| ADJUST | 조정 | 재고 실사 |

## 재고 예약 패턴

### 2단계 예약

```
1단계: RESERVE (임시 예약)
   └── 주문 생성 시 가용 재고에서 차감
   └── 결제 대기 상태

2단계: CONFIRM (확정) 또는 RELEASE (해제)
   └── 결제 성공: CONFIRM → 실제 출고 대기
   └── 결제 실패/취소: RELEASE → 가용 재고 복원
```

### 구현

```kotlin
@Service
class InventoryService(
    private val inventoryRepository: InventoryRepository,
    private val eventPublisher: EventPublisher
) {
    @Transactional
    suspend fun reserve(productId: String, quantity: Int): Reservation {
        val inventory = inventoryRepository.findByProductId(productId)
            ?: throw ProductNotFoundException()

        // 가용 재고 확인
        if (!inventory.canSell(quantity)) {
            throw InsufficientStockException(productId, inventory.availableStock)
        }

        // 예약 처리
        inventory.reservedStock += quantity

        // 저장 (낙관적 락으로 동시성 제어)
        inventoryRepository.save(inventory)

        // 이벤트 발행
        eventPublisher.publish(StockReservedEvent(productId, quantity))

        return Reservation(
            id = generateId(),
            productId = productId,
            quantity = quantity,
            status = ReservationStatus.RESERVED
        )
    }

    @Transactional
    suspend fun confirm(reservations: List<Reservation>) {
        reservations.forEach { reservation ->
            val inventory = inventoryRepository.findByProductId(reservation.productId)!!

            // 예약 → 물리 재고 차감
            inventory.reservedStock -= reservation.quantity
            inventory.physicalStock -= reservation.quantity

            inventoryRepository.save(inventory)
        }
    }

    @Transactional
    suspend fun release(reservations: List<Reservation>) {
        reservations.forEach { reservation ->
            val inventory = inventoryRepository.findByProductId(reservation.productId)!!

            // 예약 해제
            inventory.reservedStock -= reservation.quantity

            inventoryRepository.save(inventory)
        }
    }
}
```

## 동시성 처리

### 낙관적 락

```kotlin
// JPA Version 필드 사용
@Entity
class Inventory {
    @Version
    var version: Long = 0
}

// 충돌 시 재시도
@Retryable(
    value = [OptimisticLockingFailureException::class],
    maxAttempts = 3
)
fun reserve(productId: String, quantity: Int): Reservation {
    // ...
}
```

### 비관적 락 (고경합 상황)

```kotlin
@Query("SELECT i FROM Inventory i WHERE i.productId = :productId")
@Lock(LockModeType.PESSIMISTIC_WRITE)
fun findByProductIdWithLock(productId: String): Inventory?
```

## 품절 처리

### 품절 감지

```kotlin
fun checkStockStatus(productId: String): StockStatus {
    val inventory = inventoryRepository.findByProductId(productId)!!

    return when {
        inventory.availableStock <= 0 -> StockStatus.OUT_OF_STOCK
        inventory.availableStock <= inventory.safetyStock -> StockStatus.LOW_STOCK
        else -> StockStatus.IN_STOCK
    }
}
```

### 재입고 알림

```kotlin
// 품절 시 알림 신청
suspend fun subscribeRestock(userId: String, productId: String) {
    restockSubscriptionRepository.save(
        RestockSubscription(userId, productId)
    )
}

// 입고 시 알림 발송
suspend fun notifyRestock(productId: String) {
    val subscribers = restockSubscriptionRepository.findByProductId(productId)
    subscribers.forEach { sub ->
        notificationService.send(
            userId = sub.userId,
            message = "상품이 재입고되었습니다"
        )
    }
}
```

## 다중 창고

```kotlin
data class InventoryLocation(
    val productId: String,
    val warehouseId: String,
    val stock: Int,
    val priority: Int  // 출고 우선순위
)

fun selectWarehouse(productId: String, quantity: Int): Warehouse {
    val locations = inventoryRepository.findByProductIdOrderByPriority(productId)

    // 우선순위 순으로 재고 확인
    for (location in locations) {
        if (location.stock >= quantity) {
            return warehouseRepository.findById(location.warehouseId)!!
        }
    }

    throw InsufficientStockException()
}
```

## 재고 이력

```kotlin
data class StockMovement(
    val id: String,
    val productId: String,
    val warehouseId: String,
    val type: MovementType,      // RECEIVE, SHIP, ADJUST, RESERVE, RELEASE
    val quantity: Int,
    val beforeStock: Int,
    val afterStock: Int,
    val reason: String?,
    val referenceId: String?,   // 주문ID, 입고ID 등
    val createdAt: Instant,
    val createdBy: String
)
```

## 참고사항

- 재고 변경은 반드시 트랜잭션 내에서 처리
- 동시성 이슈가 빈번한 경우 비관적 락 고려
- 품절 상태 변경 시 검색 인덱스 업데이트
- 재고 이력은 수정 불가 (Append Only)
