# 도메인 로직 체크리스트

이커머스 도메인 로직 검증 체크리스트입니다.

## 재고 관리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 재고 동시성 | 낙관적/비관적 락으로 동시 주문 처리 | CRITICAL |
| 재고 예약 | 주문 생성 시 재고 예약, 결제 완료 시 확정 | CRITICAL |
| 재고 복원 | 주문 취소 시 재고 자동 복원 | CRITICAL |
| 음수 재고 방지 | 재고 수량 음수 불가 제약 | CRITICAL |
| 가용 재고 계산 | 물리재고 - 예약재고 = 가용재고 | MAJOR |
| 품절 처리 | 품절 시 주문 불가 처리 | MAJOR |

### 동시성 패턴

```kotlin
// ✅ 올바른 패턴 - 낙관적 락
@Version var version: Long = 0

// ✅ 고경합 시 - 비관적 락
@Lock(LockModeType.PESSIMISTIC_WRITE)
fun findByIdWithLock(id: String): Inventory?

// ❌ 금지 - 락 없는 동시 수정
fun updateStock(id: String, quantity: Int) {
    val inventory = findById(id)
    inventory.stock -= quantity  // Race Condition 위험
    save(inventory)
}
```

## 주문 상태 관리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 상태 전이 검증 | 허용된 상태 전이만 가능 | CRITICAL |
| 무효 전이 방지 | 불가능한 상태 변경 차단 | CRITICAL |
| 상태 이력 기록 | 상태 변경 시 이력 저장 | MAJOR |
| 롤백 처리 | 실패 시 이전 상태로 복구 | MAJOR |

### 상태 전이 규칙

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

## 가격 계산

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 가격 무결성 | 주문 시점 가격 저장 (가격 변동 대응) | CRITICAL |
| 할인 적용 순서 | 정해진 우선순위로 할인 적용 | MAJOR |
| 할인 한도 | 최대 할인 금액 제한 | MAJOR |
| 소수점 처리 | 원 단위 미만 절사/반올림 명확히 | MAJOR |
| 마이너스 금액 방지 | 최종 결제 금액 0원 이상 | MAJOR |

## 쿠폰/프로모션

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 쿠폰 유효성 | 기간, 조건, 사용 가능 여부 검증 | CRITICAL |
| 중복 사용 방지 | 동일 쿠폰 재사용 차단 | CRITICAL |
| 동시성 제어 | 선착순 쿠폰 발급 시 락 처리 | CRITICAL |
| 적용 조건 검증 | 최소 금액, 적용 상품 조건 확인 | MAJOR |
| 할인 금액 분배 | 취소 시 정확한 환불 위해 항목별 기록 | MAJOR |

## 배송 처리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 배송지 검증 | 유효한 주소인지 확인 | MAJOR |
| 도서산간 처리 | 추가 요금 자동 적용 | MINOR |
| 배송 불가 지역 | 주문 전 차단 | MAJOR |
| 송장 번호 | 배송 시작 시 송장 번호 필수 | MAJOR |

## 결제 연동

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 금액 검증 | 서버에서 결제 금액 재검증 | CRITICAL |
| 멱등성 | 중복 결제 방지 | CRITICAL |
| 타임아웃 | 결제 응답 타임아웃 처리 | MAJOR |
| 실패 복구 | 결제 실패 시 재고 복원 | CRITICAL |
| 웹훅 검증 | 결제사 웹훅 서명 검증 | CRITICAL |

## 취소/환불

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 취소 조건 검증 | 배송 전 취소 가능 여부 | MAJOR |
| 부분 취소 | 일부 상품만 취소 가능 | MAJOR |
| 환불 금액 계산 | 할인 배분 고려한 정확한 환불액 | CRITICAL |
| 쿠폰 복원 | 조건 충족 시 쿠폰 재발급 | MINOR |

## 마켓플레이스

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 셀러간 재고 분리 | 셀러 A 재고 변동이 셀러 B에 영향 없음 | CRITICAL |
| 서브오더 분리 | 멀티셀러 주문 시 셀러별 서브오더 생성 | CRITICAL |
| 정산 분리 | 플랫폼 수수료와 셀러 정산액 분리 계산 | CRITICAL |
| 수수료 BigDecimal | 수수료 계산 시 BigDecimal + HALF_UP | MAJOR |
| 셀러 상태 전이 | 허용된 상태 전이만 수행 (marketplace.md 참조) | MAJOR |
| 정산 상태 전이 | 허용된 상태 전이만 수행 (seller-settlement.md 참조) | MAJOR |
| 정산 조정 후 재확정 | adjusted 상태에서 confirmed로 재전이 경로 존재 확인 | CRITICAL |
| 크로스셀러 접근 방지 | 셀러가 다른 셀러의 주문/정산 데이터 접근 불가 | CRITICAL |

## 구독 커머스

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 구독 상태 전이 | 허용된 상태 전이만 수행 (subscription-commerce.md 참조) | CRITICAL |
| 결제 재시도 한도 | 최대 3회 재시도 후 canceled 전이 | MAJOR |
| 프로레이션 BigDecimal | 일할 계산 시 BigDecimal + HALF_UP | MAJOR |
| 빌링키 만료 처리 | 빌링키 만료 시 결제 실패 → 사용자 알림 | MAJOR |
| 일시정지 자동 해지 | 연속 90일 초과 시 paused→canceled 자동 전이 | MAJOR |

## 사용 방법

이 체크리스트는 이커머스 도메인 코드 리뷰 시 자동으로 적용됩니다.
재고 동시성, 상태 전이 오류, 크로스셀러 접근은 CRITICAL로 즉시 수정이 필요합니다.
