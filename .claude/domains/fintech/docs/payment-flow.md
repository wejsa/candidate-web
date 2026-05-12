# 결제 플로우

## 개요

결제 시스템의 핵심 플로우인 승인, 취소, 환불 프로세스를 설명합니다.

## 승인 플로우

### 일반 승인
```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Client  │────▶│ Gateway │────▶│ Payment │────▶│ VAN/PG  │
│         │     │         │     │ Service │     │         │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
     │               │               │               │
     │ 승인 요청     │ 라우팅/검증   │ 카드사 연동   │ 승인 처리
     │               │               │               │
     │◀──────────────┴───────────────┴───────────────┘
     │           승인 결과 응답
```

### 승인 요청 필수 항목

| 필드 | 설명 | 필수 |
|------|------|------|
| `merchantId` | 가맹점 ID | ✅ |
| `orderId` | 주문 ID (멱등성 키) | ✅ |
| `amount` | 결제 금액 (BigDecimal) | ✅ |
| `cardNumber` | 카드 번호 (암호화) | ✅ |
| `expiryDate` | 유효기간 | ✅ |
| `installment` | 할부 개월 | ❌ |

### 승인 응답

```json
{
  "transactionId": "TXN202601010001",
  "status": "APPROVED",
  "approvalNumber": "12345678",
  "approvedAt": "2026-01-01T12:00:00Z",
  "amount": 10000
}
```

## 취소 플로우

### 전체 취소
```
원거래 조회 → 취소 가능 여부 확인 → 취소 요청 → 상태 업데이트
```

### 부분 취소
```
원거래 조회 → 취소 가능 금액 확인 → 부분 취소 요청 → 잔여 금액 계산
```

### 취소 규칙

| 규칙 | 설명 |
|------|------|
| 당일 취소 | 승인 취소 (망상 취소) |
| 익일 이후 | 환불 처리 (별도 정산) |
| 부분 취소 | 원거래 금액 범위 내 |
| 취소 횟수 | 최대 N회까지 허용 |

## 환불 플로우

### 환불 유형

| 유형 | 설명 | 정산 |
|------|------|------|
| 전체 환불 | 전액 환불 | 원거래 정산 취소 |
| 부분 환불 | 일부 금액 환불 | 차액 정산 |
| 포인트 환불 | 포인트로 환불 | 별도 정산 |

### 환불 상태
> 환불 상태 머신은 [refund-cancel.md](refund-cancel.md)에서 SSOT로 관리합니다.

**상태**: REQUESTED → PENDING → PROCESSING → COMPLETED / FAILED / CANCELLED

## 상태 머신

### 거래 상태

```kotlin
enum class TransactionStatus {
    INITIATED,      // 거래 시작
    AUTHORIZED,     // 승인 완료
    CAPTURED,       // 매입 완료
    CANCELLED,      // 취소됨
    REFUNDED,       // 환불됨
    PARTIAL_REFUND, // 부분 환불
    FAILED,         // 실패
    EXPIRED         // 만료
}
```

### 허용된 전이

| From | To | 조건 |
|------|-----|------|
| INITIATED | AUTHORIZED | 승인 성공 |
| INITIATED | FAILED | 승인 실패 |
| AUTHORIZED | CAPTURED | 매입 요청 |
| AUTHORIZED | CANCELLED | 당일 취소 |
| INITIATED | EXPIRED | 승인 타임아웃 |
| AUTHORIZED | FAILED | 매입 실패 |
| CAPTURED | REFUNDED | 전체 환불 |
| CAPTURED | PARTIAL_REFUND | 부분 환불 |

## 멱등성

### 멱등성 키
- `orderId` + `merchantId` 조합
- 동일 키로 재요청 시 기존 결과 반환

### 구현 패턴

```kotlin
@Transactional
suspend fun processPayment(request: PaymentRequest): PaymentResponse {
    // 1. 멱등성 키 조회
    val existing = paymentRepository.findByIdempotencyKey(request.idempotencyKey)
    if (existing != null) {
        return existing.toResponse()
    }

    // 2. 새 거래 처리
    val transaction = createTransaction(request)

    // 3. 외부 연동
    val result = pgClient.authorize(transaction)

    // 4. 결과 저장
    return saveAndReturn(transaction, result)
}
```

## 참고사항

- 금액 계산 시 반드시 `BigDecimal` 사용
- 모든 거래에 고유 `transactionId` 부여
- 외부 연동 실패 시 재시도 로직 필수
- 감사 로그 필수 기록
