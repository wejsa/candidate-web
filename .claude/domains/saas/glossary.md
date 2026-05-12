# SaaS 도메인 용어집

| 용어 | 영문 | 설명 |
|------|------|------|
| 테넌트 | Tenant | SaaS 플랫폼의 독립적 고객 단위 (조직/회사) |
| 멀티테넌시 | Multi-tenancy | 단일 인프라에서 여러 테넌트를 격리 운영하는 아키텍처 |
| RLS | Row-Level Security | DB 행 수준 접근 제어로 테넌트 데이터 격리 |
| 프로비저닝 | Provisioning | 신규 테넌트 생성 시 스키마/데이터/설정 초기화 과정 |
| 프로레이션 | Proration | 플랜 변경 시 일할 계산 (월 요금 / 해당 월 일수 x 잔여 일수) |
| 플랜 | Plan | 기능/자원 제한이 정의된 구독 상품 단위 (Free, Starter, Pro, Enterprise) |
| 시트 | Seat | 사용자 단위 과금 기준 |
| 쿼터 | Quota | 플랜별 자원 사용 한도 (API 호출 수, 저장 용량 등) |
| 소프트 리밋 | Soft Limit | 초과 시 경고 후 허용 (초과분 과금) |
| 하드 리밋 | Hard Limit | 초과 시 즉시 차단 (HTTP 429) |
| 오버리지 | Overage | 쿼터 초과 사용량에 대한 추가 과금 |
| 피처 게이팅 | Feature Gating | 플랜에 따라 기능 접근을 제어하는 메커니즘 |
| 인보이스 | Invoice | 청구서 — 기본료, 시트, 초과분, 세금 항목 포함 |
| 웹훅 | Webhook | 이벤트 발생 시 외부 URL로 HTTP POST를 전송하는 알림 메커니즘 |
| DPA | Data Processing Agreement | GDPR에 따른 데이터 처리 계약 |
| 노이지 네이버 | Noisy Neighbor | 한 테넌트의 과도한 자원 사용이 다른 테넌트에 영향을 주는 문제 |
| RBAC | Role-Based Access Control | 역할 기반 접근 제어 |
