# 보안 체크리스트

금융 서비스 보안 검증 체크리스트입니다.

## 인증/토큰 보안

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 토큰 로깅 금지 | JWT 토큰 평문 로그 출력 금지 | CRITICAL |
| 비밀키 강도 | 256bit 이상 비밀키 사용 | CRITICAL |
| 토큰 만료 | 적절한 만료 시간 설정 | CRITICAL |
| Refresh Token 보호 | HttpOnly, Secure Cookie | CRITICAL |
| Token Rotation | Refresh 시 새 토큰 쌍 발급 | MAJOR |
| Token Reuse Detection | 재사용 감지 시 무효화 | MAJOR |

### 토큰 로깅 패턴

```kotlin
// ❌ 절대 금지
logger.info("Token: $accessToken")
logger.debug("Authorization: Bearer $token")

// ✅ 허용
logger.info("Token validated for user: ${claims.sub}")
logger.debug("Token expires at: ${claims.exp}")
```

## API 보안

| 항목 | 설명 | 심각도 |
|------|------|--------|
| HTTPS 필수 | 프로덕션 환경 HTTPS | CRITICAL |
| API 키 보호 | 클라이언트 노출 금지 | CRITICAL |
| Rate Limiting | 요청 제한 적용 | CRITICAL |
| 입력 검증 | 모든 입력 데이터 검증 | CRITICAL |
| CORS 설정 | 허용된 Origin만 | MAJOR |

### Rate Limiting 설정

| 대상 | 제한 |
|------|------|
| IP 기반 | 100 req/분 |
| 사용자 기반 | 1000 req/분 |
| 로그인 시도 | 5회/5분 |

## 민감정보 보호

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 카드번호 마스킹 | 앞6 + **** + 뒤4 | CRITICAL |
| CVV/CVC 미저장 | 인증 후 즉시 삭제 | CRITICAL |
| 비밀번호 해시 | bcrypt (cost 12+) | CRITICAL |
| 개인정보 암호화 | AES-256 암호화 저장 | MAJOR |
| 로그 마스킹 | 민감정보 로그 마스킹 | MAJOR |

### 마스킹 패턴

```kotlin
// 카드번호
fun maskCardNumber(cardNumber: String): String {
    return cardNumber.take(6) + "****" + cardNumber.takeLast(4)
}

// 이메일
fun maskEmail(email: String): String {
    val (local, domain) = email.split("@")
    return local.take(2) + "***@" + domain
}

// 전화번호
fun maskPhone(phone: String): String {
    return phone.take(3) + "-****-" + phone.takeLast(4)
}
```

## SQL Injection 방지

| 항목 | 설명 | 심각도 |
|------|------|--------|
| PreparedStatement | 파라미터 바인딩 필수 | CRITICAL |
| ORM 사용 | JPA/Hibernate 권장 | MAJOR |
| 동적 쿼리 검증 | 동적 쿼리 시 철저한 검증 | CRITICAL |
| 입력값 이스케이프 | 특수문자 이스케이프 | MAJOR |

### SQL Injection 방지 패턴

```kotlin
// ❌ 금지 - SQL Injection 취약
val query = "SELECT * FROM users WHERE id = '$userId'"

// ✅ 안전 - PreparedStatement
val query = "SELECT * FROM users WHERE id = ?"
jdbcTemplate.queryForObject(query, userId)

// ✅ 안전 - JPA
userRepository.findById(userId)
```

## XSS 방지

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 출력 인코딩 | HTML 엔티티 인코딩 | CRITICAL |
| CSP 헤더 | Content-Security-Policy 설정 | MAJOR |
| 입력 검증 | 스크립트 태그 필터링 | MAJOR |

## 에러 메시지 보안

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 스택 트레이스 노출 금지 | 프로덕션에서 상세 에러 숨김 | CRITICAL |
| 내부 정보 노출 금지 | DB 스키마, 서버 정보 등 | CRITICAL |
| 일관된 에러 메시지 | 인증 실패 시 동일 메시지 | MAJOR |

### 에러 응답 패턴

```kotlin
// ❌ 금지 - 내부 정보 노출
{
    "error": "User not found in table pg_users (id=123)",
    "stackTrace": "..."
}

// ✅ 안전 - 일반화된 메시지
{
    "error": {
        "code": "PG-GW-012",
        "message": "인증에 실패했습니다"
    }
}
```

## 보안 헤더

| 헤더 | 값 | 용도 |
|------|-----|------|
| Strict-Transport-Security | max-age=31536000 | HTTPS 강제 |
| X-Content-Type-Options | nosniff | MIME 스니핑 방지 |
| X-Frame-Options | DENY | 클릭재킹 방지 |
| X-XSS-Protection | 1; mode=block | XSS 필터 |
| Content-Security-Policy | default-src 'self' | CSP |

## 의존성 보안

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 취약점 스캔 | 정기적 의존성 보안 검사 | MAJOR |
| 보안 패치 | 보안 업데이트 즉시 적용 | MAJOR |
| 버전 관리 | 안정 버전 사용 | MINOR |

## 사용 방법

이 체크리스트는 보안 관점 코드 리뷰 시 자동으로 적용됩니다.
토큰 로깅, SQL Injection 취약점은 CRITICAL로 즉시 수정이 필요합니다.
