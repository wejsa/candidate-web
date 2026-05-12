# 도메인 로직 체크리스트

금융 서비스 도메인 로직 검증 체크리스트입니다.

## 금액 처리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| BigDecimal 사용 | 금액 계산 시 BigDecimal 필수 (float/double 금지) | CRITICAL |
| 정밀도 설정 | scale 및 rounding mode 명시 | CRITICAL |
| 음수 검증 | 금액 음수 여부 검증 | MAJOR |
| 최대값 검증 | 거래 한도 초과 검증 | MAJOR |
| 통화 코드 | ISO 4217 통화 코드 사용 | MINOR |

### BigDecimal 패턴

```kotlin
// ✅ 올바른 사용
val amount = BigDecimal("10000.00")
val fee = amount.multiply(feeRate).setScale(2, RoundingMode.HALF_UP)

// ❌ 금지
val amount = 10000.0  // double 사용 금지
val fee = amount * 0.03  // 부동소수점 연산 금지
```

## 상태 머신

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 유효 전이 | 허용된 상태 전이만 가능 | CRITICAL |
| 무효 전이 방지 | 비정상 상태 전이 차단 | CRITICAL |
| 상태 이력 | 상태 변경 이력 기록 | MAJOR |
| 동시성 처리 | 동시 상태 변경 방지 (락/버전) | MAJOR |

### 상태 전이 규칙

```kotlin
enum class PaymentStatus {
    INITIATED, AUTHORIZED, CAPTURED, CANCELLED, REFUNDED, PARTIAL_REFUND, FAILED, EXPIRED
}

val validTransitions = mapOf(
    INITIATED to setOf(AUTHORIZED, FAILED, EXPIRED),
    AUTHORIZED to setOf(CAPTURED, CANCELLED, FAILED),
    CAPTURED to setOf(REFUNDED, PARTIAL_REFUND),
    // CANCELLED, REFUNDED, PARTIAL_REFUND, FAILED, EXPIRED는 종료 상태
)

fun validateTransition(from: PaymentStatus, to: PaymentStatus): Boolean {
    return validTransitions[from]?.contains(to) ?: false
}
```

## 멱등성

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 멱등성 키 | 결제/취소 요청에 멱등성 키 필수 | CRITICAL |
| 중복 요청 처리 | 동일 키 재요청 시 기존 결과 반환 | CRITICAL |
| 키 TTL | 적절한 만료 시간 설정 | MAJOR |
| 키 형식 | 고유성 보장되는 키 형식 | MINOR |

## 동시성 제어

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 이중 결제 방지 | 동일 주문 중복 결제 차단 | CRITICAL |
| 이중 취소 방지 | 동일 거래 중복 취소 차단 | CRITICAL |
| 낙관적 락 | 버전 필드로 동시 수정 감지 | MAJOR |
| 비관적 락 | 필요 시 DB 락 사용 | MAJOR |

### 낙관적 락 패턴

```kotlin
@Entity
class Payment(
    @Id val id: String,
    var status: PaymentStatus,
    @Version var version: Long = 0
)

@Transactional
fun cancelPayment(paymentId: String): Payment {
    val payment = paymentRepository.findById(paymentId)
        ?: throw NotFoundException()

    if (!canCancel(payment.status)) {
        throw InvalidStateException()
    }

    payment.status = PaymentStatus.CANCELLED
    return paymentRepository.save(payment)  // version 자동 증가
}
```

## 정산 일관성

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 수수료 계산 정확성 | 소수점 처리, 반올림 규칙 | CRITICAL |
| 정산 금액 검증 | 거래금액 - 수수료 = 정산금액 | CRITICAL |
| 정산 데이터 불변 | 확정된 정산 데이터 수정 불가 | MAJOR |
| 대사 검증 | 카드사 데이터와 대사 | MAJOR |
| 정산 상태 전이 | 허용된 상태 전이만 수행 (settlement.md 허용 전이 테이블 참조) | CRITICAL |

## 타임존 처리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| UTC 저장 | DB에 UTC로 저장 | MAJOR |
| 타임존 변환 | 표시 시 로컬 타임존 변환 | MINOR |
| 정산 기준 시각 | 정산 기준일 명확히 | MAJOR |

## 외부 연동

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 타임아웃 설정 | 적절한 타임아웃 설정 | CRITICAL |
| 재시도 로직 | 실패 시 재시도 (멱등성 보장 시) | MAJOR |
| Fallback | 장애 시 대체 처리 | MAJOR |
| Circuit Breaker | 연속 실패 시 차단 | MAJOR |

## 데이터 무결성

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 트랜잭션 경계 | 원자성 보장 범위 명확히 | CRITICAL |
| 외래키 정합성 | 참조 무결성 유지 | MAJOR |
| 인덱스 정합성 | 고유 인덱스로 중복 방지 | MAJOR |

## 오픈뱅킹 연동

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 이체 상태 전이 | 허용된 상태 전이만 수행 (open-banking.md 참조) | CRITICAL |
| 출금-입금 원자성 | 출금 후 입금 실패 시 출금 원복(환불) 처리 | CRITICAL |
| 재시도 멱등성 | 타임아웃 재시도 시 동일 거래고유번호 사용 | CRITICAL |
| 은행 점검 시간 처리 | 23:30~00:30 이체 요청 차단 또는 예약 처리 | MAJOR |
| 일 호출 한도 | API별 일일 호출 한도 초과 방지 | MAJOR |

## 마이데이터 연동

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 전송요구 상태 전이 | 허용된 상태 전이만 수행 (mydata.md 참조) | CRITICAL |
| 동의 범위 검증 | 수집 데이터가 동의 범위 내인지 확인 | CRITICAL |
| 만료 데이터 삭제 | 동의 유효기간 만료 데이터 자동 삭제 배치 | MAJOR |
| 전송 실패 재시도 | 최대 3회 재시도 후 failed 전이 (expired는 동의 유효기간 만료 전용) | MAJOR |
| 재동의 검증 | 수집 범위 변경 시 재동의 획득 확인 | MAJOR |

## 사용 방법

이 체크리스트는 결제/정산/오픈뱅킹/마이데이터 로직 리뷰 시 자동으로 적용됩니다.
BigDecimal 미사용, 상태 전이 오류, 토큰 노출은 CRITICAL로 분류됩니다.
