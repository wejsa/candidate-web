# 테넌트 보안 체크리스트

SaaS 멀티테넌트 환경의 데이터 격리 및 접근 통제 검증 체크리스트입니다.

## 테넌트 격리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| tenant_id 필터 필수 | 모든 비즈니스 데이터 쿼리에 tenant_id WHERE 조건 존재 | CRITICAL |
| RLS 정책 적용 | 테넌트 데이터 테이블에 Row-Level Security 정책 설정 | CRITICAL |
| 격리 전략 일관성 | 선택한 격리 전략(DB/스키마/행) 일관 적용, 혼용 금지 | CRITICAL |
| 테넌트간 JOIN 금지 | 크로스테넌트 데이터를 JOIN하는 쿼리 금지 | CRITICAL |
| 인덱스 tenant_id 포함 | 주요 조회 쿼리 인덱스에 tenant_id 포함 | MAJOR |
| 벌크 연산 테넌트 제한 | 대량 UPDATE/DELETE에 tenant_id 필터 필수 | MAJOR |

## API 테넌트 컨텍스트

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 인증 시 tenantId 추출 | JWT/세션에서 tenantId 추출 후 요청 컨텍스트에 설정 | CRITICAL |
| 리소스 소유권 검증 | 요청 리소스의 tenantId와 인증 tenantId 일치 확인 | CRITICAL |
| API 키 테넌트 바인딩 | API 키 사용 시 해당 키의 tenantId로 컨텍스트 설정 | CRITICAL |
| 테넌트 컨텍스트 전파 | 서비스 간 호출에 tenantId 전파 (헤더 또는 메시지 속성) | MAJOR |
| 테넌트 미설정 차단 | tenantId 없는 요청은 비즈니스 로직 진입 전 차단 | MAJOR |

## 크로스테넌트 방지

| 항목 | 설명 | 심각도 |
|------|------|--------|
| URL 파라미터 테넌트 검증 | /tenants/{id}/resources 에서 {id}와 인증 tenantId 일치 | CRITICAL |
| 캐시 키 테넌트 프리픽스 | Redis 등 캐시 키에 tenant:{tenantId}: 프리픽스 필수 | MAJOR |
| 파일 스토리지 경로 분리 | S3 등 저장 경로에 tenantId 포함, 타 테넌트 경로 접근 불가 | MAJOR |
| 큐 메시지 테넌트 포함 | 비동기 메시지에 tenantId 필드 필수 포함 | MAJOR |

## 세션/인증 격리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 세션 테넌트 바인딩 | 세션에 tenantId 포함, 테넌트 전환 시 재인증 | CRITICAL |
| SSO 테넌트 매핑 | SAML/OIDC 응답의 조직 정보와 테넌트 정확히 매핑 | MAJOR |
| 초대 토큰 테넌트 고정 | 멤버 초대 토큰에 대상 tenantId 포함, 타 테넌트로 사용 불가 | MAJOR |

## 로깅 보안

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 크로스테넌트 데이터 로그 금지 | 타 테넌트 식별 가능 데이터(이름, 이메일 등) 로깅 금지 | CRITICAL |
| 로그에 tenantId 포함 | 모든 로그 라인에 tenantId 필드 포함 (추적용) | MAJOR |

## 테넌트 삭제/오프보딩

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 완전 삭제 검증 | terminated 테넌트 데이터가 보존 기간 후 전체 삭제 확인 | CRITICAL |
| API 키 즉시 폐기 | 테넌트 suspended/terminated 시 모든 API 키 무효화 | MAJOR |
| 웹훅 즉시 중단 | 테넌트 suspended/terminated 시 웹훅 발송 중단 | MAJOR |

## 사용 방법

이 체크리스트는 SaaS 도메인 코드 리뷰 시 자동으로 적용됩니다.
테넌트 격리 위반(크로스테넌트 접근)은 CRITICAL로 즉시 수정이 필요합니다.
