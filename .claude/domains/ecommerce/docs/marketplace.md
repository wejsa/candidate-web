# 마켓플레이스 (멀티셀러)

## 개요

플랫폼이 직접 판매하지 않고 다수의 판매자(셀러)가 상품을 등록·판매하는 중개 모델입니다. 주문 분리, 셀러별 정산, 통신판매중개업자 의무가 핵심입니다.

## 셀러 상태 머신

```
pending → under_review → active → suspended → terminated
              ↘ rejected    ↓         ↗ (위반 시)
              (재신청→pending) ↘ terminated (자진 탈퇴/계약 만료)
```

| 상태 | 설명 | 전이 조건 |
|------|------|----------|
| pending | 입점 신청 접수 | 셀러 회원가입 완료 |
| under_review | 심사 중 | 서류 제출 완료 |
| active | 판매 활성 | 심사 승인 |
| rejected | 심사 반려 | 심사 불합격 (재신청 가능) |
| suspended | 일시 정지 | 정책 위반, 민원 누적 |
| terminated | 계약 해지 | 계약 만료, 영구 정지 |

### 허용 전이

| From | To | 조건 |
|------|----|------|
| pending | under_review | 필수 서류 제출 |
| under_review | active | 심사 승인 |
| under_review | rejected | 심사 반려 |
| rejected | pending | 재신청 |
| active | suspended | 정책 위반 감지 |
| suspended | active | 시정 조치 완료 |
| suspended | terminated | 시정 기한 초과 |
| active | terminated | 셀러 자진 탈퇴 또는 계약 만료 |

### 셀러 상태 변경 시 서브오더 처리

| 셀러 상태 | 신규 주문 | 진행 중 서브오더 | 정산 |
|-----------|----------|----------------|------|
| active | 허용 | 정상 처리 | 정상 |
| suspended | 차단 | 배송 완료까지 허용 (신규 발송 차단) | 보류 (HOLD) |
| terminated | 차단 | 플랫폼 직접 이행 또는 강제 환불 | 잔여 정산 후 종료 |

> **terminated 전이 선행 조건**: 진행 중 서브오더(created~shipping)가 있으면 terminated 전이가 차단됩니다. 모든 서브오더가 종료 상태(confirmed, returned, refunded)에 도달해야 terminated가 가능합니다.

## 멀티셀러 주문 분리

하나의 주문에 여러 셀러의 상품이 포함되면 **셀러별 서브오더**로 분리합니다.

```
Order #1001
├── SubOrder #1001-A (셀러 A) → 독립 배송, 독립 정산
├── SubOrder #1001-B (셀러 B) → 독립 배송, 독립 정산
└── SubOrder #1001-C (셀러 C) → 독립 배송, 독립 정산
```

### 분리 규칙

| 규칙 | 설명 |
|------|------|
| 셀러 단위 분리 | 동일 셀러 상품은 하나의 서브오더로 묶음 |
| 독립 배송 | 서브오더별 독립 배송 추적 |
| 독립 취소/환불 | 서브오더 단위 부분 취소 가능 |
| 통합 결제 | 결제는 원 주문 단위로 한 번 |
| 분리 정산 | 정산은 서브오더 단위로 셀러별 수행 |

### 서브오더 상태 머신

```
created → paid → shipping → delivered → confirmed → settled
                                ↘ return_requested → returned → refunded
```

#### 서브오더 허용 전이

| From | To | 조건 |
|------|----|------|
| created | paid | 원 주문 결제 완료 |
| created | cancelled | 원 주문 결제 취소 또는 타임아웃 |
| paid | shipping | 셀러 발송 처리 |
| paid | cancel_requested | 발송 전 취소 요청 |
| shipping | delivered | 배송 완료 확인 |
| delivered | confirmed | 구매 확정 (수동 또는 자동 N일 후) |
| delivered | return_requested | 구매자 반품 요청 |
| confirmed | settled | 정산 완료 |
| return_requested | returned | 반품 수거 완료 |
| returned | refunded | 환불 처리 완료 |

각 서브오더는 **원 주문과 독립적으로** 상태가 전이됩니다. 원 주문의 상태는 서브오더 상태의 집계입니다:
- 모든 서브오더 delivered → 원 주문 delivered
- 일부 서브오더 shipping → 원 주문 partially_shipped
- 모든 서브오더 confirmed → 원 주문 completed

## 커미션 모델

| 모델 | 설명 | 적용 |
|------|------|------|
| 고정 수수료율 | 판매가의 N% | 카테고리별 차등 (예: 의류 12%, 전자 8%) |
| 등급별 차등 | 셀러 등급에 따라 수수료율 차등 | 월 매출 기준 등급 산정 |
| 카테고리 + 등급 | 카테고리 기본 + 등급 할인 | 복합 적용 |

### 수수료 계산

```
판매가 × 수수료율 = 플랫폼 수수료
판매가 - 플랫폼 수수료 - 결제 수수료(PG 분담분) - 배송비(셀러 부담 시) = 셀러 정산액
```

> 상세 정산 계산(프로모션 분담금, 반품 차감 등)은 `seller-settlement.md` 참조

- 모든 금액 계산은 **BigDecimal** 사용 필수
- 수수료율은 소수점 2자리까지 (예: 12.50%)
- 반올림은 **HALF_UP** 적용

## 셀러 등급 체계

| 등급 | 조건 (예시) | 혜택 |
|------|-----------|------|
| 신규 | 입점 후 3개월 미만 | 기본 수수료율 |
| 일반 | 월 매출 500만 미만 | 기본 수수료율 |
| 우수 | 월 매출 500만 이상 + 반품률 3% 이하 | 수수료 1%p 할인 |
| 프리미엄 | 월 매출 2,000만 이상 + 반품률 2% 이하 | 수수료 2%p 할인 + 노출 우선 |

## 참고사항

- 셀러 상태 변경은 반드시 감사 로그 기록
- 서브오더 분리는 결제 완료 시점에 수행
- 셀러별 재고는 독립 관리 (셀러 A 품절이 셀러 B에 영향 없음)
- 통신판매중개업자로서의 법적 의무는 compliance 체크리스트 참조
- 정산 상세는 `seller-settlement.md` 참조
