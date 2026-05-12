# 프로모션 / 쿠폰

## 개요

할인, 쿠폰, 프로모션 시스템의 구조와 적용 규칙을 설명합니다.

## 할인 유형

| 유형 | 설명 | 예시 |
|------|------|------|
| PERCENTAGE | 비율 할인 | 10% 할인 |
| FIXED_AMOUNT | 정액 할인 | 5,000원 할인 |
| FREE_SHIPPING | 배송비 무료 | 무료 배송 |
| BUY_X_GET_Y | N+1 할인 | 2+1 행사 |
| BUNDLE | 묶음 할인 | 세트 10% 할인 |

## 쿠폰 구조

```kotlin
data class Coupon(
    val id: String,
    val code: String,                     // 쿠폰 코드
    val name: String,
    val discountType: DiscountType,
    val discountValue: BigDecimal,        // 할인율 또는 할인금액
    val minOrderAmount: BigDecimal?,      // 최소 주문 금액
    val maxDiscountAmount: BigDecimal?,   // 최대 할인 금액
    val applicableCategories: List<String>?,  // 적용 카테고리
    val applicableProducts: List<String>?,    // 적용 상품
    val excludedProducts: List<String>?,      // 제외 상품
    val startDate: Instant,
    val endDate: Instant,
    val usageLimit: Int?,                 // 총 사용 횟수 제한
    val usageLimitPerUser: Int?,          // 사용자당 사용 횟수
    var usedCount: Int = 0,
    val isActive: Boolean = true
)

enum class DiscountType {
    PERCENTAGE,
    FIXED_AMOUNT,
    FREE_SHIPPING
}
```

## 쿠폰 적용 로직

### 적용 가능 여부 검증

```kotlin
@Service
class CouponService(
    private val couponRepository: CouponRepository,
    private val couponUsageRepository: CouponUsageRepository
) {
    fun validateCoupon(
        coupon: Coupon,
        order: Order,
        userId: String
    ): CouponValidation {
        val errors = mutableListOf<String>()

        // 1. 활성 상태 확인
        if (!coupon.isActive) {
            errors.add("비활성화된 쿠폰입니다")
        }

        // 2. 유효 기간 확인
        val now = Instant.now()
        if (now < coupon.startDate || now > coupon.endDate) {
            errors.add("쿠폰 유효 기간이 아닙니다")
        }

        // 3. 최소 주문 금액 확인
        coupon.minOrderAmount?.let { minAmount ->
            if (order.pricing.itemsTotal < minAmount) {
                errors.add("최소 주문 금액 ${minAmount}원 이상이어야 합니다")
            }
        }

        // 4. 총 사용 횟수 확인
        coupon.usageLimit?.let { limit ->
            if (coupon.usedCount >= limit) {
                errors.add("쿠폰 사용 한도가 초과되었습니다")
            }
        }

        // 5. 사용자별 사용 횟수 확인
        coupon.usageLimitPerUser?.let { limit ->
            val userUsage = couponUsageRepository.countByUserIdAndCouponId(userId, coupon.id)
            if (userUsage >= limit) {
                errors.add("쿠폰을 더 이상 사용할 수 없습니다")
            }
        }

        // 6. 적용 가능 상품 확인
        val applicableItems = getApplicableItems(coupon, order.items)
        if (applicableItems.isEmpty()) {
            errors.add("쿠폰 적용 가능한 상품이 없습니다")
        }

        return CouponValidation(
            isValid = errors.isEmpty(),
            errors = errors,
            applicableItems = applicableItems
        )
    }
}
```

### 할인 금액 계산

```kotlin
fun calculateDiscount(
    coupon: Coupon,
    applicableItems: List<OrderItem>
): BigDecimal {
    val applicableAmount = applicableItems.sumOf { it.totalPrice }

    val discount = when (coupon.discountType) {
        DiscountType.PERCENTAGE -> {
            applicableAmount * (coupon.discountValue / BigDecimal(100))
        }
        DiscountType.FIXED_AMOUNT -> {
            coupon.discountValue
        }
        DiscountType.FREE_SHIPPING -> {
            BigDecimal.ZERO  // 배송비는 별도 처리
        }
    }

    // 최대 할인 금액 제한
    return coupon.maxDiscountAmount?.let { max ->
        minOf(discount, max)
    } ?: discount
}
```

## 프로모션 규칙

### 자동 적용 프로모션

```kotlin
data class Promotion(
    val id: String,
    val name: String,
    val conditions: List<PromotionCondition>,
    val rewards: List<PromotionReward>,
    val priority: Int,           // 적용 우선순위
    val stackable: Boolean,      // 중복 적용 가능 여부
    val startDate: Instant,
    val endDate: Instant
)

sealed class PromotionCondition {
    data class MinOrderAmount(val amount: BigDecimal) : PromotionCondition()
    data class MinQuantity(val quantity: Int) : PromotionCondition()
    data class Category(val categoryIds: List<String>) : PromotionCondition()
    data class FirstOrder(val isFirstOrder: Boolean) : PromotionCondition()
}

sealed class PromotionReward {
    data class Discount(val type: DiscountType, val value: BigDecimal) : PromotionReward()
    data class FreeItem(val productId: String, val quantity: Int) : PromotionReward()
    data class Points(val points: Int) : PromotionReward()
}
```

### 프로모션 적용

```kotlin
@Service
class PromotionEngine(
    private val promotionRepository: PromotionRepository
) {
    fun applyPromotions(order: Order, userId: String): List<AppliedPromotion> {
        val activePromotions = promotionRepository.findActivePromotions()
        val appliedPromotions = mutableListOf<AppliedPromotion>()

        for (promotion in activePromotions.sortedBy { it.priority }) {
            // 조건 검사
            if (!checkConditions(promotion.conditions, order, userId)) {
                continue
            }

            // 중복 적용 검사
            if (!promotion.stackable && appliedPromotions.isNotEmpty()) {
                continue
            }

            // 리워드 적용
            val rewards = applyRewards(promotion.rewards, order)
            appliedPromotions.add(AppliedPromotion(promotion, rewards))
        }

        return appliedPromotions
    }
}
```

## 할인 적용 우선순위

```
1. 상품 할인 (개별 상품 세일)
2. 카테고리 할인 (카테고리 프로모션)
3. 장바구니 할인 (전체 주문 할인)
4. 쿠폰 할인 (사용자 입력 쿠폰)
5. 포인트 사용
```

### 중복 적용 규칙

| 할인 유형 | 상품할인 | 카테고리할인 | 쿠폰 |
|----------|---------|------------|------|
| 상품할인 | - | ❌ | ✅ |
| 카테고리할인 | ❌ | - | ✅ |
| 쿠폰 | ✅ | ✅ | ❌ |

## 쿠폰 발급

### 대량 발급

```kotlin
suspend fun bulkIssueCoupons(
    couponId: String,
    userIds: List<String>
): List<CouponIssue> {
    val coupon = couponRepository.findById(couponId)!!

    return userIds.map { userId ->
        CouponIssue(
            couponId = couponId,
            userId = userId,
            code = generateUniqueCode(),
            issuedAt = Instant.now()
        )
    }.also { issues ->
        couponIssueRepository.saveAll(issues)
    }
}
```

### 선착순 발급

```kotlin
@Transactional
suspend fun claimCoupon(couponId: String, userId: String): CouponIssue {
    val coupon = couponRepository.findByIdWithLock(couponId)!!

    // 재고 확인
    if (coupon.usedCount >= (coupon.usageLimit ?: Int.MAX_VALUE)) {
        throw CouponExhaustedException()
    }

    // 발급 처리
    coupon.usedCount++
    couponRepository.save(coupon)

    return couponIssueRepository.save(CouponIssue(
        couponId = couponId,
        userId = userId,
        code = generateUniqueCode(),
        issuedAt = Instant.now()
    ))
}
```

## 참고사항

- 할인 금액은 항목별로 배분하여 기록 (정산/취소 대응)
- 쿠폰 사용 시 즉시 사용 처리 (동시성 고려)
- 프로모션 변경 시 기존 적용 건 영향 없음
- 할인 이력 상세 기록 (감사 목적)
