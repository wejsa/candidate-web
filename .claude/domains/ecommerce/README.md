# 이커머스 도메인

상품, 주문, 재고, 배송, 프로모션 등 이커머스 서비스를 위한 도메인 템플릿입니다.

## 개요

| 항목 | 내용 |
|------|------|
| **도메인 ID** | ecommerce |
| **적합한 프로젝트** | 쇼핑몰, 마켓플레이스, O2O, 커머스 플랫폼 |
| **주요 규정** | 전자상거래법, 소비자보호법, 개인정보보호법 |
| **기본 스택** | Spring Boot (Kotlin) + Next.js + MySQL + Redis |

## 핵심 개념

### 주문 플로우
```
장바구니 → 주문서 → 결제 → 주문 확정 → 배송 → 완료
    ↓                                    ↓
   취소 ←───────────────────────────── 반품/교환
```

### 재고 관리
- **가용 재고**: 판매 가능한 재고
- **예약 재고**: 주문 확정 전 임시 보류
- **실제 재고**: 물리적 보유 재고

### 프로모션 유형
- **쿠폰**: 할인 코드 기반
- **자동 할인**: 조건 충족 시 자동 적용
- **번들**: 상품 묶음 할인

## 참고 문서

| 문서 | 설명 |
|------|------|
| [order-flow.md](docs/order-flow.md) | 주문 플로우 |
| [inventory.md](docs/inventory.md) | 재고 관리 |
| [shipping.md](docs/shipping.md) | 배송 프로세스 |
| [promotion.md](docs/promotion.md) | 프로모션/쿠폰 |
| [payment-integration.md](docs/payment-integration.md) | 결제 연동 |
| [marketplace.md](docs/marketplace.md) | 마켓플레이스 (멀티셀러) |
| [seller-settlement.md](docs/seller-settlement.md) | 셀러 정산 |
| [subscription-commerce.md](docs/subscription-commerce.md) | 구독 커머스 |
| [member.md](docs/member.md) | 회원 관리 |
| [product.md](docs/product.md) | 상품 관리 |

## 체크리스트

| 체크리스트 | 설명 |
|-----------|------|
| [domain-logic.md](checklists/domain-logic.md) | 재고 동시성, 주문 상태 |
| [compliance.md](checklists/compliance.md) | 전자상거래법 준수 |
| [performance.md](checklists/performance.md) | 대용량 트래픽 처리 |

## 사용 방법

### 1. 프로젝트 초기화
```bash
/skill-init
# 도메인 선택: ecommerce
```

### 2. 참고자료 조회
```bash
/skill-docs order       # 주문 관련 문서
/skill-docs inventory   # 재고 관련 문서
```

## 용어집

주요 이커머스 용어는 [glossary.md](glossary.md)를 참조하세요.
