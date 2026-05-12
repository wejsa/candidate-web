# 웹훅 연동

## 개요

테넌트가 자체 시스템과 연동하기 위한 웹훅 설정, 이벤트 배달, 서명 검증을 정의합니다.

## 웹훅 설정 모델

| 항목 | 설명 |
|------|------|
| endpoint URL | 테넌트가 등록한 수신 URL (HTTPS 필수) |
| secret | 테넌트별 서명 검증 키 (자동 생성, 회전 가능) |
| 구독 이벤트 | 수신할 이벤트 유형 선택 |
| 활성 상태 | enabled / disabled / suspended (실패 누적 시) |

### 웹훅 상태 머신

```
enabled ⇄ disabled (사용자 활성/비활성화)
  ↘ suspended → enabled (사용자 재활성화)
```

## 이벤트 유형

| 이벤트 | 설명 | 페이로드 예시 키 |
|--------|------|----------------|
| tenant.created | 테넌트 생성 | tenantId, name |
| tenant.suspended | 테넌트 정지 | tenantId, reason |
| subscription.activated | 구독 활성화 | tenantId, planId |
| subscription.canceled | 구독 해지 | tenantId, canceledAt |
| invoice.paid | 인보이스 결제 | tenantId, invoiceId, amount |
| invoice.failed | 결제 실패 | tenantId, invoiceId, failureReason |
| member.invited | 멤버 초대 | tenantId, email, role |
| member.removed | 멤버 제거 | tenantId, userId |
| usage.limit_reached | 쿼터 도달 | tenantId, resource, usage, limit |

## 배달 보장

| 규칙 | 설명 |
|------|------|
| 최소 1회 배달 | at-least-once 보장 (수신 측 멱등성 필요) |
| 타임아웃 | 5초 이내 HTTP 2xx 응답 필요 |
| 재시도 | 실패 시 progressive backoff (1분, 5분, 30분, 2시간, 24시간) |
| 최대 재시도 | 5회 재시도 후 이벤트 DROP + 로그 기록 |
| 연속 실패 | 10회 연속 실패 시 웹훅 suspended + 테넌트 Admin 알림 |

### 배달 순서

| 규칙 | 설명 |
|------|------|
| 순서 보장 없음 | 이벤트 배달 순서는 보장하지 않음 |
| 타임스탬프 | 각 이벤트에 발생 시각 포함 → 수신 측에서 순서 판단 |
| 중복 가능 | 동일 이벤트 2회 이상 배달 가능 → 수신 측 멱등 처리 |

## 서명 검증

### 서명 생성

```
signature = HMAC-SHA256(secret, timestamp + "." + payload)
```

### 검증 헤더

| 헤더 | 설명 |
|------|------|
| X-Webhook-Signature | HMAC-SHA256 서명값 (hex) |
| X-Webhook-Timestamp | 이벤트 발생 시각 (Unix epoch) |
| X-Webhook-Event | 이벤트 유형 (e.g., invoice.paid) |
| X-Webhook-Id | 이벤트 고유 ID (멱등성 키) |

### 서명 검증 규칙

| 규칙 | 설명 |
|------|------|
| timestamp 검증 | 현재 시각과 5분 이상 차이 시 거부 (리플레이 방지) |
| secret 회전 | 회전 시 신규+기존 secret 모두 유효 (7일 유예) |

## 웹훅 관리

### 테넌트 Admin 기능

| 기능 | 설명 |
|------|------|
| URL 등록/수정 | HTTPS URL만 허용 |
| 이벤트 구독 선택 | 이벤트 유형별 on/off |
| 테스트 발송 | 샘플 이벤트 수동 발송 |
| 배달 로그 | 최근 N건 배달 이력 (상태, 응답 코드, 시각) |
| secret 회전 | 신규 secret 생성, 기존 7일 유예 후 폐기 |

## 참고사항

- 웹훅 URL은 HTTPS 필수 (HTTP 거부)
- 페이로드에 민감 정보(PII) 포함 금지 → ID만 전달, 수신 측이 API로 상세 조회
- 웹훅 배달 실패 이력은 30일 보존
- suspended 웹훅 재활성화 시 밀린 이벤트 재전송하지 않음 (시점 이후부터)
