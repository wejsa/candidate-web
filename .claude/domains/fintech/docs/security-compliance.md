# 보안 및 컴플라이언스

## 개요

금융 서비스에 필요한 보안 요구사항과 규정 준수 사항을 설명합니다.

## PCI-DSS 요구사항

### 카드 데이터 보호

| 요구사항 | 설명 | 구현 |
|----------|------|------|
| 저장 금지 | CVV, PIN 저장 금지 | 메모리에서만 처리 |
| 암호화 | 카드번호 암호화 저장 | AES-256 |
| 마스킹 | 표시 시 마스킹 | 앞 6자리 + **** + 뒤 4자리 |
| 접근 제한 | 필요 인원만 접근 | RBAC 적용 |

### 카드번호 마스킹

```kotlin
fun maskCardNumber(cardNumber: String): String {
    require(cardNumber.length >= 13) { "Invalid card number" }

    val first6 = cardNumber.take(6)
    val last4 = cardNumber.takeLast(4)
    val masked = "*".repeat(cardNumber.length - 10)

    return "$first6$masked$last4"
}

// 결과: 123456******1234
```

### 로깅 규칙

```kotlin
// ❌ 금지
logger.info("Card: $cardNumber")
logger.debug("CVV: $cvv")

// ✅ 허용
logger.info("Card: ${maskCardNumber(cardNumber)}")
logger.debug("Payment processed for masked card: ****1234")
```

## 전자금융감독규정

### 주요 요구사항

| 항목 | 요구사항 | 구현 |
|------|----------|------|
| 접근통제 | 비인가 접근 차단 | 인증 + 인가 |
| 감사추적 | 거래 이력 보존 | 감사 로그 |
| 암호화 | 전송/저장 암호화 | TLS + AES |
| 백업 | 데이터 백업 | 일일 백업 |

### 감사 로그

```kotlin
data class AuditLog(
    val id: String,
    val timestamp: Instant,
    val action: String,
    val userId: String,
    val resourceType: String,
    val resourceId: String,
    val ipAddress: String,
    val userAgent: String,
    val requestData: String,    // 민감정보 마스킹
    val responseCode: Int,
    val success: Boolean
)
```

### 보존 기간

| 데이터 유형 | 보존 기간 |
|------------|----------|
| 거래 기록 | 5년 |
| 접근 로그 | 1년 |
| 에러 로그 | 6개월 |
| 감사 로그 | 5년 |

## 개인정보보호법

### 수집 원칙

| 원칙 | 설명 |
|------|------|
| 최소 수집 | 필요 최소한의 정보만 |
| 목적 명시 | 수집 목적 명확히 |
| 동의 획득 | 명시적 동의 필요 |
| 기간 제한 | 목적 달성 후 파기 |

### 개인정보 항목

| 구분 | 항목 | 처리 |
|------|------|------|
| 필수 | 이름, 이메일 | 암호화 저장 |
| 선택 | 전화번호, 주소 | 동의 시 수집 |
| 민감 | 카드정보 | 토큰화 처리 |

## 암호화

### 전송 암호화

| 구간 | 방식 |
|------|------|
| 클라이언트 ↔ Gateway | TLS 1.3 |
| Gateway ↔ 내부 서비스 | mTLS |
| Gateway ↔ 외부 PG | TLS 1.2+ |

### 저장 암호화

| 데이터 | 알고리즘 | 키 관리 |
|--------|----------|---------|
| 카드번호 | AES-256-GCM | KMS |
| 개인정보 | AES-256-CBC | 환경변수 |
| 비밀번호 | bcrypt (cost 12) | Salt 포함 |

### 암호화 구현

```kotlin
@Service
class EncryptionService(
    @Value("\${encryption.key}") private val key: String
) {
    private val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    private val secretKey = SecretKeySpec(key.toByteArray(), "AES")

    fun encrypt(plainText: String): String {
        val iv = ByteArray(12).apply { SecureRandom().nextBytes(this) }
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(128, iv))

        val encrypted = cipher.doFinal(plainText.toByteArray())
        return Base64.getEncoder().encodeToString(iv + encrypted)
    }

    fun decrypt(cipherText: String): String {
        val decoded = Base64.getDecoder().decode(cipherText)
        val iv = decoded.sliceArray(0 until 12)
        val encrypted = decoded.sliceArray(12 until decoded.size)

        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        return String(cipher.doFinal(encrypted))
    }
}
```

## 접근 제어

### RBAC 모델

```kotlin
enum class Role {
    SUPER_ADMIN,      // 시스템 전체 관리
    MERCHANT_ADMIN,   // 가맹점 관리자
    MERCHANT_USER,    // 가맹점 사용자
    SUPPORT,          // 고객지원
    VIEWER            // 조회 전용
}
```

### 권한 매트릭스

| 리소스 | SUPER_ADMIN | MERCHANT_ADMIN | MERCHANT_USER |
|--------|-------------|----------------|---------------|
| 거래 조회 | ✅ 전체 | ✅ 본인 가맹점 | ✅ 본인 가맹점 |
| 거래 취소 | ✅ | ✅ | ❌ |
| 정산 조회 | ✅ | ✅ | ❌ |
| 설정 변경 | ✅ | ✅ 제한적 | ❌ |

## 보안 체크리스트

### 개발 시

- [ ] 민감정보 로깅 금지
- [ ] 카드번호 마스킹 적용
- [ ] 입력값 검증
- [ ] SQL Injection 방지
- [ ] XSS 방지

### 배포 시

- [ ] HTTPS 적용
- [ ] 보안 헤더 설정
- [ ] 취약점 스캔
- [ ] 의존성 보안 검사

### 운영 시

- [ ] 로그 모니터링
- [ ] 이상 탐지
- [ ] 정기 보안 점검
- [ ] 침투 테스트
