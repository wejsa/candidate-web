# 범용 도메인

도메인 특화 없는 범용 프로젝트를 위한 기본 템플릿입니다.

## 개요

| 항목 | 내용 |
|------|------|
| **도메인 ID** | general |
| **적합한 프로젝트** | 도메인 특화가 필요 없는 일반 프로젝트 |
| **주요 규정** | 없음 (기본 보안 체크리스트만 적용) |
| **기본 스택** | Spring Boot (Kotlin) + MySQL |

## 특징

### 최소 설정
- 도메인별 추가 체크리스트 없음
- 공통 베이스 체크리스트만 적용
- 간단한 프로젝트에 적합

### 커스터마이징
이 도메인은 프로젝트별 커스터마이징의 시작점입니다.
필요에 따라 다음을 추가할 수 있습니다:

```bash
# 참고자료 추가
/skill-domain add-doc "my-docs.md"

# 체크리스트 추가
/skill-domain add-checklist "my-checklist.md"

# 커스텀 도메인으로 내보내기
/skill-domain export my-custom-domain
```

## 적용 체크리스트

### 공통 (_base)
- `common.md` - 코드 품질, 테스트 기본
- `security-basic.md` - 기본 보안 체크리스트

### 도메인 특화
없음

## 사용 방법

### 1. 프로젝트 초기화
```bash
/skill-init
# 도메인 선택: general
```

### 2. 기능 개발
```bash
/skill-feature "사용자 인증"
/skill-plan
/skill-impl
```

### 3. 필요 시 도메인 전환
```bash
/skill-domain switch fintech    # fintech로 전환
/skill-domain switch ecommerce  # ecommerce로 전환
```

## 참고 문서

| 문서 | 설명 |
|------|------|
| [getting-started.md](docs/getting-started.md) | 시작 가이드 |

## 다른 도메인으로 전환

프로젝트가 특정 도메인에 속하게 되면 해당 도메인으로 전환하세요:

| 도메인 | 적합한 경우 |
|--------|----------|
| fintech | 결제, 정산, 금융 서비스 |
| ecommerce | 쇼핑몰, 마켓플레이스 |
| healthcare | 의료, 헬스케어 |
| saas | B2B SaaS 플랫폼 |
