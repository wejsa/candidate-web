# 취소/환불 정책

## 개요

결제 취소 및 환불 처리에 대한 정책과 프로세스를 설명합니다.

## 취소 vs 환불

| 구분 | 취소 | 환불 |
|------|------|------|
| **시점** | 매입 전 | 매입 후 |
| **처리 방식** | 원거래 취소 | 반대 거래 생성 |
| **정산 영향** | 정산 제외 | 환불 정산 |
| **카드사 처리** | 승인 취소 | 환불 매입 |

## 취소 처리

### 당일 취소 (망상 취소)

```
원거래 → 취소 요청 → 카드사 승인 취소 → 거래 상태 변경
```

**조건:**
- 거래 당일 내 요청
- 매입 전 거래만 가능
- 전체 금액 취소

### 익일 이후 취소

```
원거래 → 취소 요청 → 환불 거래 생성 → 환불 매입 요청
```

**조건:**
- 매입 완료된 거래
- 환불로 처리됨

## 부분 취소/환불

### 규칙

| 규칙 | 설명 |
|------|------|
| 금액 제한 | 원거래 금액 이하 |
| 횟수 제한 | 최대 N회까지 |
| 최소 금액 | 부분 취소 최소 금액 |
| 잔여 금액 | 원거래 - 누적 취소액 |

### 부분 취소 계산

```kotlin
fun calculatePartialCancel(
    originalAmount: BigDecimal,
    cancelledAmount: BigDecimal,
    requestAmount: BigDecimal
): PartialCancelResult {
    val remainingAmount = originalAmount - cancelledAmount

    require(requestAmount <= remainingAmount) {
        "취소 요청 금액이 잔여 금액을 초과합니다"
    }

    return PartialCancelResult(
        cancelAmount = requestAmount,
        remainingAmount = remainingAmount - requestAmount
    )
}
```

## 환불 유형

### 카드 환불

```
환불 요청 → 원거래 확인 → 카드사 환불 요청 → 환불 완료
```

- 원결제 카드로 환불
- 정산 시 차감 처리

### 계좌 환불

```
환불 요청 → 계좌 정보 확인 → 계좌 이체 → 환불 완료
```

- 카드 환불 불가 시 사용
- 별도 이체 수수료 발생 가능

### 포인트 환불

```
환불 요청 → 포인트 적립 → 환불 완료
```

- 현금성 포인트로 환불
- 가맹점 정책에 따름

## 환불 상태

```kotlin
enum class RefundStatus {
    REQUESTED,      // 환불 요청
    PENDING,        // 처리 대기
    PROCESSING,     // 처리 중
    COMPLETED,      // 환불 완료
    FAILED,         // 환불 실패
    CANCELLED       // 요청 취소
}
```

### 상태 전이

```
REQUESTED → PENDING → PROCESSING → COMPLETED
    │          │          │
    └──────────┴──────────┴──▶ FAILED
                                  │
    CANCELLED ◀───────────────────┘
```

## 취소/환불 제한

### 불가 사유

| 사유 | 설명 |
|------|------|
| 정산 완료 | 가맹점 정산 완료 후 |
| 기간 초과 | 환불 가능 기간 초과 |
| 금액 초과 | 잔여 금액 초과 |
| 상태 불가 | 이미 취소/환불된 거래 |

### 예외 처리

```kotlin
sealed class CancelException : RuntimeException() {
    object AlreadyCancelled : CancelException()
    object PeriodExpired : CancelException()
    object AmountExceeded : CancelException()
    object SettlementCompleted : CancelException()
}
```

## API 예시

### 취소 요청

```json
{
  "originalTransactionId": "TXN202601010001",
  "cancelAmount": 10000,
  "reason": "고객 요청",
  "requestedBy": "admin@merchant.com"
}
```

### 취소 응답

```json
{
  "cancelTransactionId": "CXL202601020001",
  "originalTransactionId": "TXN202601010001",
  "status": "COMPLETED",
  "cancelledAmount": 10000,
  "remainingAmount": 0,
  "processedAt": "2026-01-02T10:00:00Z"
}
```

## 참고사항

- 취소/환불 사유 필수 기록
- 감사 로그에 요청자 정보 포함
- 중복 취소 방지 로직 필수
- 환불 가능 기간 설정 권장
