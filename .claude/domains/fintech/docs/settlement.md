# 정산 프로세스

## 개요

가맹점에 대한 결제 대금 정산 프로세스를 설명합니다.

## D+N 정산 체계

### 정산 주기

| 유형 | 설명 | 예시 |
|------|------|------|
| D+0 | 당일 정산 | 거래 당일 정산 |
| D+1 | 익일 정산 | 거래 다음날 정산 |
| D+2 | D+2 정산 | 거래 2일 후 정산 |
| D+3 | D+3 정산 | 거래 3일 후 정산 |

### 정산 프로세스

```
거래 승인 → 매입 요청 → 카드사 정산 → 가맹점 정산
    │           │           │           │
  D+0        D+0~1       D+1~2       D+N
```

## 수수료 체계

### 수수료 구성

| 항목 | 설명 |
|------|------|
| 카드 수수료 | 카드사에 지급하는 수수료 |
| VAN 수수료 | VAN사에 지급하는 수수료 |
| PG 수수료 | PG사 수수료 (마진) |
| 총 수수료 | 가맹점 부담 총 수수료 |

### 수수료율 계산

```kotlin
data class FeeRate(
    val cardRate: BigDecimal,    // 카드사 수수료율
    val vanRate: BigDecimal,     // VAN 수수료율
    val pgRate: BigDecimal       // PG 수수료율
) {
    val totalRate: BigDecimal
        get() = cardRate + vanRate + pgRate
}

fun calculateFee(amount: BigDecimal, feeRate: FeeRate): Fee {
    return Fee(
        totalAmount = amount,
        feeAmount = amount * feeRate.totalRate,
        settlementAmount = amount - (amount * feeRate.totalRate)
    )
}
```

### 수수료 결정 요소

| 요소 | 영향 |
|------|------|
| 업종 | 업종별 기본 수수료율 |
| 거래량 | 월 거래량에 따른 할인 |
| 카드 종류 | 신용/체크 카드 수수료 차이 |
| 할부 | 무이자/유이자 할부 수수료 |

## 정산 대사

### 대사 프로세스

```
1. 카드사 정산 데이터 수신 (파일/API)
2. 내부 거래 데이터 조회
3. 데이터 매칭 (승인번호, 금액)
4. 불일치 건 분류
5. 차이 원인 분석
6. 수정 처리
```

### 불일치 유형

| 유형 | 설명 | 처리 |
|------|------|------|
| 누락 | 카드사에 없는 거래 | 원인 조사 |
| 초과 | 내부에 없는 거래 | 카드사 확인 |
| 금액 차이 | 금액 불일치 | 수정 정산 |
| 상태 차이 | 취소 여부 불일치 | 상태 동기화 |

## 정산 보고서

### 일별 정산 요약

```json
{
  "settlementDate": "2026-01-15",
  "summary": {
    "totalTransactions": 1234,
    "totalAmount": 12340000,
    "totalFee": 246800,
    "settlementAmount": 12093200
  },
  "byCardCompany": [
    {
      "cardCompany": "SHINHAN",
      "count": 456,
      "amount": 4560000
    }
  ]
}
```

### 가맹점별 정산 명세

| 항목 | 설명 |
|------|------|
| 거래 건수 | 정산 대상 거래 수 |
| 거래 금액 | 총 거래 금액 |
| 수수료 | 차감 수수료 |
| 정산 금액 | 실 정산 금액 |
| 정산 예정일 | 입금 예정일 |

## 정산 상태

```kotlin
enum class SettlementStatus {
    PENDING,        // 정산 대기
    CALCULATING,    // 정산 계산 중
    CONFIRMED,      // 정산 확정
    PROCESSING,     // 이체 처리 중
    COMPLETED,      // 정산 완료
    FAILED,         // 정산 실패
    HOLD            // 정산 보류
}
```

### 허용 전이

| From | To | 조건 |
|------|-----|------|
| PENDING | CALCULATING | D+N 도래, 배치 시작 |
| CALCULATING | CONFIRMED | 수수료 계산 완료 + 대사 일치 |
| CALCULATING | FAILED | 계산 오류 또는 대사 불일치 |
| CONFIRMED | PROCESSING | 이체 배치 실행 |
| CONFIRMED | HOLD | 분쟁 제기 또는 규제 보류 |
| PROCESSING | COMPLETED | 이체 완료 확인 |
| PROCESSING | FAILED | 이체 실패 |
| FAILED | PENDING | 재정산 요청 (수동) |
| HOLD | CONFIRMED | 보류 해제 |
| HOLD | FAILED | 보류 후 정산 취소 |

> **종료 상태**: COMPLETED
> **트리거**: 거래 CAPTURED 이벤트 발생 시 해당 가맹점의 정산 레코드(PENDING)가 자동 생성됨

## 참고사항

- 금액 계산 시 반드시 `BigDecimal` 사용 (정밀도 유지)
- 정산 데이터는 변경 불가 (이력 관리)
- 수수료율 변경 시 적용 시점 명확히
- 정산 보류 사유 필수 기록
