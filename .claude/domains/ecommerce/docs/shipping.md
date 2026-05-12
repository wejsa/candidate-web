# 배송 프로세스

## 개요

주문 상품의 배송 처리 프로세스를 설명합니다.

## 배송 상태

```
PENDING → READY → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
    │                                                            │
    └─────────────────────────────────────────────────────── RETURNED
```

| 상태 | 설명 |
|------|------|
| PENDING | 배송 대기 (상품 준비 중) |
| READY | 출고 준비 완료 |
| PICKED_UP | 택배사 수거 완료 |
| IN_TRANSIT | 배송 중 |
| OUT_FOR_DELIVERY | 배송 출발 |
| DELIVERED | 배송 완료 |
| RETURNED | 반송 |

## 배송 생성

```kotlin
@Service
class ShippingService(
    private val shippingRepository: ShippingRepository,
    private val carrierClient: CarrierClient
) {
    @Transactional
    suspend fun createShipment(order: Order): Shipment {
        // 1. 배송 정보 생성
        val shipment = Shipment(
            orderId = order.id,
            shippingAddress = order.shippingAddress,
            items = order.items.map { it.toShippingItem() },
            status = ShippingStatus.PENDING
        )

        // 2. 택배사 선택
        val carrier = selectCarrier(order)
        shipment.carrierId = carrier.id

        // 3. 운송장 번호 발급 요청
        val trackingInfo = carrierClient.requestTracking(carrier.id, shipment)
        shipment.trackingNumber = trackingInfo.trackingNumber

        return shippingRepository.save(shipment)
    }
}
```

## 택배사 연동

### 택배사 선택 로직

```kotlin
fun selectCarrier(order: Order): Carrier {
    val carriers = carrierRepository.findAllActive()

    return carriers
        .filter { it.canDeliver(order.shippingAddress) }
        .minByOrNull { it.getShippingFee(order) }
        ?: throw NoAvailableCarrierException()
}
```

### 배송비 계산

```kotlin
data class ShippingFee(
    val basePrice: BigDecimal,
    val weightExtra: BigDecimal,
    val regionExtra: BigDecimal,
    val totalFee: BigDecimal
)

fun calculateShippingFee(order: Order, carrier: Carrier): ShippingFee {
    val basePrice = carrier.basePrice
    val totalWeight = order.items.sumOf { it.weight * it.quantity }

    // 중량 추가 요금
    val weightExtra = if (totalWeight > carrier.freeWeightLimit) {
        ((totalWeight - carrier.freeWeightLimit) / 1000) * carrier.weightExtraPerKg
    } else BigDecimal.ZERO

    // 지역 추가 요금 (도서산간)
    val regionExtra = if (isRemoteArea(order.shippingAddress)) {
        carrier.remoteAreaExtra
    } else BigDecimal.ZERO

    return ShippingFee(
        basePrice = basePrice,
        weightExtra = weightExtra,
        regionExtra = regionExtra,
        totalFee = basePrice + weightExtra + regionExtra
    )
}
```

## 배송 추적

### 웹훅 수신

```kotlin
@RestController
class ShippingWebhookController(
    private val shippingService: ShippingService
) {
    @PostMapping("/webhooks/shipping/{carrierId}")
    suspend fun handleWebhook(
        @PathVariable carrierId: String,
        @RequestBody payload: ShippingWebhookPayload
    ): ResponseEntity<Unit> {
        shippingService.updateStatus(
            trackingNumber = payload.trackingNumber,
            status = payload.status.toShippingStatus(),
            location = payload.location,
            updatedAt = payload.timestamp
        )

        return ResponseEntity.ok().build()
    }
}
```

### 배송 조회 API

```kotlin
@GetMapping("/orders/{orderId}/shipping")
suspend fun getShippingInfo(@PathVariable orderId: String): ShippingResponse {
    val shipment = shippingService.findByOrderId(orderId)

    // 실시간 배송 정보 조회
    val trackingHistory = carrierClient.getTrackingHistory(
        shipment.carrierId,
        shipment.trackingNumber
    )

    return ShippingResponse(
        trackingNumber = shipment.trackingNumber,
        status = shipment.status,
        carrierName = shipment.carrier.name,
        estimatedDelivery = shipment.estimatedDelivery,
        history = trackingHistory
    )
}
```

## 배송지 관리

### 주소 구조

```kotlin
data class Address(
    val zipCode: String,
    val address1: String,        // 기본 주소
    val address2: String?,       // 상세 주소
    val city: String,
    val state: String,
    val country: String = "KR",
    val receiverName: String,
    val receiverPhone: String,
    val deliveryNote: String?    // 배송 요청사항
)
```

### 배송지 검증

```kotlin
fun validateAddress(address: Address): AddressValidation {
    // 우편번호 검증
    val isValidZipCode = zipCodeService.validate(address.zipCode)

    // 도서산간 여부
    val isRemoteArea = remoteAreaService.check(address.zipCode)

    // 배송 불가 지역
    val isDeliverable = !nonDeliverableService.check(address.zipCode)

    return AddressValidation(
        isValid = isValidZipCode && isDeliverable,
        isRemoteArea = isRemoteArea,
        message = if (!isDeliverable) "배송 불가 지역입니다" else null
    )
}
```

## 무료 배송 조건

```kotlin
data class FreeShippingPolicy(
    val minOrderAmount: BigDecimal,    // 무료배송 최소 금액
    val excludedCategories: List<String>,  // 제외 카테고리
    val excludedRegions: List<String>      // 제외 지역 (도서산간)
)

fun checkFreeShipping(order: Order, policy: FreeShippingPolicy): Boolean {
    // 금액 조건
    if (order.pricing.itemsTotal < policy.minOrderAmount) {
        return false
    }

    // 제외 카테고리 확인
    val hasExcluded = order.items.any { item ->
        policy.excludedCategories.contains(item.categoryId)
    }
    if (hasExcluded) return false

    // 도서산간 확인
    if (policy.excludedRegions.contains(order.shippingAddress.zipCode.take(2))) {
        return false
    }

    return true
}
```

## 반품/교환 배송

### 반품 접수

```kotlin
suspend fun createReturnShipment(returnRequest: ReturnRequest): Shipment {
    val originalShipment = shippingRepository.findByOrderId(returnRequest.orderId)

    val returnShipment = Shipment(
        orderId = returnRequest.orderId,
        type = ShipmentType.RETURN,
        shippingAddress = originalShipment.senderAddress,  // 역방향
        items = returnRequest.items,
        status = ShippingStatus.PENDING
    )

    // 반품 수거 요청
    val pickupInfo = carrierClient.requestPickup(
        returnShipment.carrierId,
        returnRequest.pickupAddress,
        returnRequest.pickupDate
    )

    return shippingRepository.save(returnShipment.copy(
        trackingNumber = pickupInfo.trackingNumber
    ))
}
```

## 참고사항

- 택배사 API 연동은 비동기 처리 권장
- 배송 상태는 웹훅으로 실시간 업데이트
- 도서산간 배송비 정책 명확히 정의
- 배송 지연 시 고객 알림 자동 발송
