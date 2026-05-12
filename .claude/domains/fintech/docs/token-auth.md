# JWT 토큰 인증

## 개요

API Gateway의 JWT 기반 인증 체계를 설명합니다.

## 토큰 구조

### Access Token

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "user-123",
    "iss": "pg-gateway",
    "iat": 1704067200,
    "exp": 1704070800,
    "roles": ["MERCHANT_ADMIN"],
    "merchantId": "MID001",
    "tokenFamily": "TF-12345"
  }
}
```

### Refresh Token

```json
{
  "payload": {
    "sub": "user-123",
    "iss": "pg-gateway",
    "iat": 1704067200,
    "exp": 1704672000,
    "tokenFamily": "TF-12345",
    "tokenVersion": 1,
    "type": "refresh"
  }
}
```

## 토큰 사양

| 항목 | Access Token | Refresh Token |
|------|--------------|---------------|
| 만료 시간 | 1시간 | 7일 |
| 알고리즘 | HS256 | HS256 |
| 저장 위치 | 메모리/로컬 | 클라이언트 저장 |
| 전달 방식 | Authorization 헤더 | JSON body |
| 갱신 방식 | Refresh로 재발급 | Token Rotation |

> **프로덕션 권장사항**: Refresh Token은 HttpOnly + Secure + SameSite Cookie로 전달하는 것을 권장합니다. 데모에서는 구현 간소화를 위해 JSON body 방식을 사용합니다.
>
> **JSON body 방식의 보안 제약**: localStorage/sessionStorage에 저장 시 XSS 공격으로 토큰 탈취가 가능합니다. 프로덕션 배포 전 반드시 Cookie 방식으로 전환하세요.

## Token Rotation

### 개념

```
Refresh Token 사용 시 → 새 Access + 새 Refresh 발급
                    → 기존 Refresh 무효화
```

### 구현

```kotlin
@Service
class TokenRotationService(
    private val tokenRepository: TokenRepository,
    private val jwtService: JwtService
) {
    suspend fun rotate(refreshToken: String): TokenPair {
        // 1. 토큰 검증
        val claims = jwtService.validateRefreshToken(refreshToken)

        // 2. CAS 기반 원자적 버전 갱신 (Race Condition 방어)
        //    ConcurrentHashMap.compute()로 check-then-act를 원자적으로 수행
        val newVersion = tokenRepository.atomicRotate(
            familyId = claims.tokenFamily,
            expectedVersion = claims.tokenVersion
        ) ?: run {
            // 토큰 재사용 감지 → 전체 무효화
            tokenRepository.revokeFamily(claims.tokenFamily)
            throw TokenException.TokenReused
        }

        // 3. 새 토큰 발급
        val newAccessToken = jwtService.generateAccessToken(claims.sub)
        val newRefreshToken = jwtService.generateRefreshToken(
            claims.sub,
            claims.tokenFamily,
            newVersion
        )

        return TokenPair(newAccessToken, newRefreshToken)
    }
}
```

### CAS 패턴 구현 (InMemoryTokenFamilyRepository)

```kotlin
class InMemoryTokenFamilyRepository : TokenRepository {
    private val families = ConcurrentHashMap<String, TokenFamily>()

    /**
     * CAS(Compare-And-Swap) 기반 원자적 버전 갱신.
     * 2 스레드가 동시에 같은 RT로 rotation을 시도해도
     * compute()의 원자성 보장으로 하나만 성공한다.
     *
     * @return 새 버전 번호 (성공 시), null (버전 불일치 시)
     */
    fun atomicRotate(familyId: String, expectedVersion: Int): Int? {
        var result: Int? = null
        families.compute(familyId) { _, family ->
            if (family == null || family.currentVersion != expectedVersion) {
                result = null
                family  // 변경 없이 반환
            } else {
                result = family.currentVersion + 1
                family.copy(currentVersion = result!!)
            }
        }
        return result
    }
}
```

## Token Reuse Detection

### 동작 방식

```
정상 흐름:
  RT(v1) 사용 → AT + RT(v2) 발급 → RT(v2) 사용 → AT + RT(v3) 발급

재사용 감지:
  RT(v1) 탈취 → 공격자 RT(v1) 사용
             → v2 이미 발급됨 → 재사용 감지!
             → Token Family 전체 무효화
```

### 보안 이점

| 시나리오 | 대응 |
|----------|------|
| RT 탈취 | 재사용 시 전체 무효화 |
| RT 복제 | 먼저 사용한 쪽이 유효 |
| 세션 하이재킹 | 피해자 재로그인으로 무효화 |

## 인증 플로우

### 로그인

```
1. 사용자 인증 (ID/PW)
2. Token Family 생성
3. Access Token + Refresh Token 발급
4. JSON Response Body로 전달
```

### API 요청

```
1. Authorization: Bearer {accessToken}
2. Gateway에서 토큰 검증
3. 사용자 정보 헤더로 전파
   - X-User-Id
   - X-User-Roles
   - X-Merchant-Mid
```

### 토큰 갱신

```
1. Access Token 만료
2. Refresh Token으로 갱신 요청
3. Token Rotation 실행
4. 새 토큰 쌍 발급
```

### 로그아웃

```
1. 로그아웃 요청
2. Token Family 무효화
3. 클라이언트 토큰 폐기
```

## 전파 헤더

| 헤더 | 설명 |
|------|------|
| X-User-Id | 사용자 ID |
| X-User-Roles | 역할 목록 (쉼표 구분) |
| X-User-Email | 이메일 |
| X-Merchant-Mid | 가맹점 ID |
| X-Merchant-Filter | 가맹점 격리 플래그 |
| X-Gateway-Request | 게이트웨이 통과 표시 |
| X-Trace-Id | 분산 추적 ID |

## 보안 규칙

### 필수 준수 사항

| 규칙 | 설명 |
|------|------|
| 비밀키 길이 | 256bit 이상 |
| 토큰 로깅 금지 | 토큰 평문 로그 출력 금지 |
| HTTPS 필수 | 프로덕션 환경 HTTPS |
| Cookie 보안 | 프로덕션 RT Cookie 전환 시: HttpOnly, Secure, SameSite |

### 금지 사항

```kotlin
// ❌ 절대 금지
logger.info("Token: $accessToken")
logger.debug("Refresh: $refreshToken")

// ✅ 허용
logger.info("Token validated for user: ${claims.sub}")
logger.debug("Token family: ${claims.tokenFamily}")
```

## 에러 처리

| 에러 | 코드 | 대응 |
|------|------|------|
| 토큰 없음 | PG-GW-001 | 로그인 필요 |
| 형식 오류 | PG-GW-002 | 토큰 재발급 |
| 만료 | PG-GW-003 | 갱신 시도 |
| 서명 불일치 | PG-GW-004 | 재로그인 |
| 토큰 재사용 | PG-GW-016 | 재로그인 + 경고 |
