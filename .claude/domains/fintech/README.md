# 핀테크 / 금융 도메인

결제, 정산, 환불, 토큰 인증 등 금융 서비스를 위한 도메인 템플릿입니다.

## 개요

| 항목 | 내용 |
|------|------|
| **도메인 ID** | fintech |
| **적합한 프로젝트** | PG, VAN, 간편결제, 정산 시스템, 금융 API |
| **주요 규정** | PCI-DSS, 전자금융감독규정, 개인정보보호법 |
| **기본 스택** | Spring Boot (Kotlin) + MySQL + Redis |

## 핵심 개념

### 결제 플로우
```
승인 요청 → 카드사/VAN 연동 → 승인 응답 → 거래 저장
    ↓
취소/환불 → 원거래 조회 → 취소 요청 → 상태 업데이트
```

### 정산 주기
- **D+N 정산**: 거래일 기준 N일 후 정산
- **수수료 체계**: 가맹점별, 카드사별 수수료율 관리
- **정산 대사**: 카드사 데이터와 내부 데이터 매칭

### 토큰 인증
- **Access Token**: 단기 토큰 (1시간)
- **Refresh Token**: 장기 토큰 (7일)
- **Token Rotation**: 보안 강화를 위한 토큰 재발급

## 참고 문서

| 문서 | 설명 |
|------|------|
| [payment-flow.md](docs/payment-flow.md) | 결제 승인/취소/환불 플로우 |
| [settlement.md](docs/settlement.md) | 정산 프로세스 |
| [refund-cancel.md](docs/refund-cancel.md) | 취소/환불 정책 |
| [token-auth.md](docs/token-auth.md) | JWT 토큰 인증 |
| [security-compliance.md](docs/security-compliance.md) | PCI-DSS, 전금법 준수 |
| [error-handling.md](docs/error-handling.md) | 에러 코드 + 재시도 전략 |
| [api-design.md](docs/api-design.md) | API 설계 가이드 |
| [open-banking.md](docs/open-banking.md) | 오픈뱅킹 이체 플로우 |
| [mydata.md](docs/mydata.md) | 마이데이터 전송요구 플로우 |

## 체크리스트

| 체크리스트 | 설명 |
|-----------|------|
| [compliance.md](checklists/compliance.md) | PCI-DSS, 전금법 규정 준수 |
| [domain-logic.md](checklists/domain-logic.md) | 상태머신, BigDecimal, 멱등성 |
| [security.md](checklists/security.md) | 카드번호 마스킹, 토큰 보안 |

## 에러 코드 체계

에러 코드는 `error-codes/error-codes.json`에 정의됩니다.

| 범위 | 분류 |
|------|------|
| 001-019 | 인증/토큰 오류 |
| 020-039 | 권한/접근 오류 |
| 040-059 | 결제/거래 오류 |
| 060-079 | 정산 오류 |
| 080-089 | 외부 연동 오류 |
| 090-099 | 시스템 오류 |

## 사용 방법

### 1. 프로젝트 초기화
```bash
/skill-init
# 도메인 선택: fintech
```

### 2. 참고자료 조회
```bash
/skill-docs payment        # 결제 관련 문서
/skill-docs settlement     # 정산 관련 문서
```

### 3. 코드 리뷰
```bash
/skill-review src/         # fintech 체크리스트 자동 적용
```

## 용어집

주요 금융 용어는 [glossary.md](glossary.md)를 참조하세요.
