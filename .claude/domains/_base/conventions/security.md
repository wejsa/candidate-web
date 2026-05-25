# 보안 개발 컨벤션

모든 프로젝트에 적용되는 보안 코딩 가이드입니다.
도메인별 규정(PCI-DSS, 전금법 등)은 해당 도메인 문서를 참조하세요.
리뷰 시 보안 체크리스트는 `security-basic.md`를 참조하세요.

## 인증 패턴

### JWT Bearer 기본 구조

```
Authorization: Bearer {access_token}
```

| 토큰 | 용도 | 만료 시간 | 저장 위치 |
|------|------|----------|----------|
| Access Token | API 인증 | 15분 ~ 1시간 | 메모리 (클라이언트) |
| Refresh Token | Access Token 갱신 | 7일 ~ 30일 | httpOnly Cookie 또는 DB |

### 토큰 구조

```json
{
  "sub": "user-123",
  "iss": "my-service",
  "iat": 1706180400,
  "exp": 1706184000,
  "roles": ["USER"],
  "jti": "unique-token-id"
}
```

| 클레임 | 설명 | 필수 |
|--------|------|------|
| sub | 사용자 식별자 | ✅ |
| iss | 발급자 | ✅ |
| iat | 발급 시각 | ✅ |
| exp | 만료 시각 | ✅ |
| roles | 권한 목록 | ✅ |
| jti | 토큰 고유 ID (재사용 방지) | ❌ |

## 인가 패턴

### RBAC (Role-Based Access Control)

```kotlin
// Spring Security - @PreAuthorize
@PreAuthorize("hasRole('ADMIN')")
@DeleteMapping("/users/{id}")
fun deleteUser(@PathVariable id: Long) { ... }

@PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
@GetMapping("/reports")
fun getReports() { ... }
```

```typescript
// Node.js - 미들웨어
const authorize = (...roles: string[]) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ code: 'AUTH-ROLE-001', message: '권한이 없습니다' });
  }
  next();
};

router.delete('/users/:id', authorize('ADMIN'), deleteUser);
```

## 입력 검증

### SQL Injection 방지

| 방법 | 적용 |
|------|------|
| PreparedStatement | 모든 SQL 쿼리 (파라미터 바인딩) |
| ORM 사용 | JPA/Hibernate, TypeORM, GORM 등 |
| 직접 SQL 금지 | 문자열 연결로 SQL 생성 절대 금지 |

```kotlin
// ✅ 안전 - PreparedStatement
@Query("SELECT u FROM User u WHERE u.email = :email")
fun findByEmail(@Param("email") email: String): User?

// ❌ 위험 - 문자열 연결
@Query("SELECT u FROM User u WHERE u.email = '" + email + "'")  // 절대 금지
```

### XSS 방지

| 방법 | 적용 시점 |
|------|----------|
| 출력 인코딩 | HTML/JSON 렌더링 시 이스케이프 |
| 입력 길이 제한 | @Size, @Length 등 |
| Content-Type 명시 | `application/json` (HTML 해석 방지) |

### Path Traversal 방지

```kotlin
// 경로 정규화 후 기준 디렉토리 내 확인
val basePath = Paths.get("/uploads").toRealPath()
val targetPath = basePath.resolve(userInput).normalize().toRealPath()
require(targetPath.startsWith(basePath)) { "잘못된 경로" }
```

## 민감 데이터 처리

| 구분 | 방법 | 알고리즘/설정 |
|------|------|-------------|
| 저장 시 암호화 | 대칭 암호화 | AES-256-GCM |
| 전송 시 암호화 | TLS | 1.2 이상 필수 |
| 비밀번호 해싱 | 단방향 해시 | bcrypt (cost 12+) |
| 키 관리 | 환경변수 또는 시크릿 매니저 | AWS KMS, HashiCorp Vault |

```kotlin
// bcrypt 비밀번호 해싱
val encoder = BCryptPasswordEncoder(12)
val hashed = encoder.encode(rawPassword)
val matches = encoder.matches(rawPassword, hashed)
```

## 보안 헤더

| 헤더 | 값 | 목적 |
|------|-----|------|
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | HTTPS 강제 |
| X-Content-Type-Options | `nosniff` | MIME 스니핑 방지 |
| X-Frame-Options | `DENY` | 클릭재킹 방지 |
| Content-Security-Policy | `default-src 'self'` | XSS/인젝션 방지 |
| X-XSS-Protection | `0` | 브라우저 XSS 필터 비활성화 (CSP 대체) |

```kotlin
// Spring Security 설정
@Bean
fun securityFilterChain(http: HttpSecurity) = http
    .headers { headers ->
        headers.frameOptions { it.deny() }
        headers.contentTypeOptions { }
        headers.httpStrictTransportSecurity {
            it.includeSubDomains(true).maxAgeInSeconds(31536000)
        }
    }
    .build()
```

## Secret 관리

| 규칙 | 설명 |
|------|------|
| 환경변수 사용 | DB 비밀번호, API 키 등은 환경변수로 주입 |
| .env Git 제외 | `.env`, `.env.local`은 반드시 `.gitignore`에 포함 |
| 코드 하드코딩 금지 | 소스코드에 시크릿 문자열 직접 작성 금지 |
| 기본값 금지 | `password: ${DB_PASSWORD:default123}` 같은 기본값 금지 |

```yaml
# ✅ 안전 - 환경변수 참조
spring:
  datasource:
    password: ${DB_PASSWORD}

# ❌ 위험 - 하드코딩
spring:
  datasource:
    password: mySecretPass123
```

## CORS 설정

| 규칙 | 설명 |
|------|------|
| 허용 origin 명시 | 정확한 도메인만 허용 |
| 와일드카드 금지 | `*` 사용 금지 (credentials와 함께 사용 불가) |
| Methods 제한 | 필요한 HTTP 메서드만 허용 |
| Max-Age 설정 | Preflight 캐시 (3600초 권장) |

```kotlin
@Configuration
class CorsConfig : WebMvcConfigurer {
    override fun addCorsMappings(registry: CorsRegistry) {
        registry.addMapping("/api/**")
            .allowedOrigins("https://my-app.com", "https://admin.my-app.com")
            .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE")
            .allowCredentials(true)
            .maxAge(3600)
    }
}
```

## 비-REST 프로토콜 보안

| 프로토콜 | 보안 요구사항 |
|----------|-------------|
| WebSocket | `wss://` 전용 (`ws://` 금지), 서버사이드 Origin 헤더 검증 필수, 핸드셰이크 시 인증 (쿠키 또는 첫 메시지 JWT) |
| SSE | TLS 필수, 인증 토큰을 URL 쿼리 파라미터에 포함 금지 (헤더 사용) |
| gRPC | TLS 채널 암호화 필수, 내부 서비스 간 mTLS 권장 |

## 파일 업로드 MIME 화이트리스트 (L-031)

파일 업로드 검증에서 **확장자 + MIME 이중 검증** 시, MIME 화이트리스트에 generic `application/octet-stream`을 폴백으로 허용하면 안 된다.

**위협**: 임의 바이너리(.exe / 셸 스크립트 등)를 허용된 확장자(.hwp / .doc 등)로 위장 + `application/octet-stream` 선언으로 검증 통과 가능. 사후 ClamAV 등이 미작동인 도입 초기 기간 동안 악성 파일 저장 위험.

**컨벤션**:
- 확장자별 화이트리스트는 **명시 MIME만** 허용 (예: `.hwp` → `application/x-hwp`, `application/haansofthwp`)
- `application/octet-stream`, `application/x-binary`, `*/*` 등 generic MIME 폴백 금지
- 클라이언트가 generic MIME으로 업로드 시도하면 422 거부 → UI에서 명시 MIME 재요청 안내
- 회귀 가드: 명시 거부 케이스 테스트 (octet-stream + 허용 확장자 조합) 최소 1건

**예시 위반**:
```ts
// ❌ HWP/HWPX의 octet-stream 폴백 — 악성 파일 위장 표면
const ALLOWED: Record<Ext, string[]> = {
  hwp: ['application/x-hwp', 'application/haansofthwp', 'application/octet-stream'], // 위험!
};
```

**안전 패턴**:
```ts
// ✅ 명시 MIME만 — generic 폴백 제거
const ALLOWED: Record<Ext, string[]> = {
  hwp: ['application/x-hwp', 'application/haansofthwp'],
  hwpx: ['application/hwp+zip'],
};
```

> **출처**: CANDID-016 Step 2 in-PR fix(S-MAJOR-2+T-MAJOR-1), PR #58.

## 외부 SDK 에러 cause 화이트리스트 (L-032)

AWS SDK / Stripe SDK / 기타 외부 라이브러리의 에러를 `AppError({cause})` 그대로 전달 금지. SDK 원본 에러에는 `requestId`, signed URL 일부, region, signature 등 민감 정보가 포함될 수 있으며, 향후 로깅 sink(Sentry/pino) 직렬화로 누출 위험.

**컨벤션**:
- `safeXxxCause(cause)` 헬퍼로 화이트리스트 필드(`name`, `statusCode`, `requestId` 등 운영 추적용)만 추출
- AppError에는 plain object 전달 (원본 Error 인스턴스 제거)
- 회귀 가드: 화이트리스트 외 필드 부재 단언 + `JSON.stringify(cause).not.toContain('signature_token')` 단언

**예시**:
```ts
function safeS3Cause(cause: unknown): { name: string; statusCode?: number; requestId?: string } {
  if (cause instanceof S3ServiceException) {
    return { name: cause.name, statusCode: cause.$metadata?.httpStatusCode, requestId: cause.$metadata?.requestId };
  }
  if (cause instanceof Error) return { name: cause.name };
  return { name: 'UnknownError' };
}

throw new AppError('FILE_UPLOAD_FAILED', { message: 'presigned URL 발급 실패', cause: safeS3Cause(cause) });
```

> **출처**: CANDID-016 Step 2 carry fix(S-MAJOR-2), PR #58.
