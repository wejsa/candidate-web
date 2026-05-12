# 로깅 컨벤션

모든 프로젝트에 적용되는 로깅 규칙입니다.
도메인별 로그 보관 정책 및 감사 로그 요구사항은 해당 도메인 문서를 참조하세요.

## 구조화된 로그 포맷

JSON 형식의 구조화된 로그를 사용합니다:

```json
{
  "timestamp": "2026-01-15T10:30:05.123Z",
  "level": "INFO",
  "logger": "com.example.payment.PaymentService",
  "message": "결제 승인 완료",
  "traceId": "abc-123-def",
  "spanId": "span-456",
  "data": {
    "paymentId": "PAY-001",
    "amount": 50000,
    "status": "APPROVED"
  }
}
```

| 필드 | 설명 | 필수 |
|------|------|------|
| timestamp | ISO 8601 (UTC) | ✅ |
| level | 로그 레벨 | ✅ |
| logger | 로거 이름 (클래스/모듈) | ✅ |
| message | 로그 메시지 | ✅ |
| traceId | 요청 추적 ID | ✅ |
| spanId | 스팬 ID (분산 추적) | ❌ |
| data | 추가 컨텍스트 데이터 | ❌ |

## 로그 레벨 기준

| 레벨 | 사용 기준 | 예시 |
|------|----------|------|
| ERROR | 즉시 조치 필요한 오류 | DB 연결 실패, 결제 처리 실패 |
| WARN | 잠재적 문제, 대안 경로 사용 | 재시도 발생, 캐시 미스, 임계값 근접 |
| INFO | 주요 비즈니스 이벤트 | 결제 승인, 사용자 로그인, 배치 완료 |
| DEBUG | 개발/디버깅용 상세 정보 | 쿼리 파라미터, 중간 처리 결과 |

### 레벨 선택 기준

- **ERROR**: 사용자 요청 실패 + 자동 복구 불가 → 알림 발생 대상
- **WARN**: 사용자 요청은 성공했으나 비정상 경로 사용 → 모니터링 대상
- **INFO**: 정상적인 비즈니스 흐름의 핵심 이벤트
- **DEBUG**: 운영 환경에서는 기본 OFF, 필요 시 동적 활성화

## 필수 로그 포인트

| 시점 | 레벨 | 포함 정보 |
|------|------|----------|
| API 요청 수신 | INFO | method, path, clientIp |
| API 응답 완료 | INFO | status, duration(ms) |
| 외부 서비스 호출 시작 | DEBUG | service, endpoint |
| 외부 서비스 호출 완료 | INFO/WARN | service, status, duration(ms) |
| 상태 변경 | INFO | entity, before, after |
| 인증 이벤트 | INFO | userId, action (login/logout/fail) |
| 에러 발생 | ERROR | errorCode, message, stackTrace |

## 민감정보 마스킹

| 유형 | 규칙 | 예시 |
|------|------|------|
| 비밀번호/토큰 | **절대 로깅 금지** | `password: [FILTERED]` |
| 카드번호 | 앞 6자리 + 뒤 4자리만 | `411111**1111` |
| 이메일 | 부분 마스킹 | `u***@example.com` |
| 전화번호 | 중간 마스킹 | `010-****-1234` |
| 주민등록번호 | **절대 로깅 금지** | `[FILTERED]` |
| API Key | 앞 4자리만 | `sk-l***` |

```kotlin
// 마스킹 적용 예시
logger.info("사용자 인증 완료: email={}", maskEmail(user.email))
// 출력: 사용자 인증 완료: email=u***@example.com
```

## MDC/CorrelationId 패턴

모든 요청에 `traceId`를 전파하여 분산 환경에서 요청을 추적합니다:

```kotlin
// Spring Boot - 필터에서 MDC 설정
class TraceFilter : OncePerRequestFilter() {
    override fun doFilterInternal(request, response, chain) {
        val traceId = request.getHeader("X-Trace-Id") ?: UUID.randomUUID().toString()
        MDC.put("traceId", traceId)
        response.setHeader("X-Trace-Id", traceId)
        try { chain.doFilter(request, response) }
        finally { MDC.clear() }
    }
}
```

```typescript
// Node.js - AsyncLocalStorage 사용
const asyncLocalStorage = new AsyncLocalStorage<{ traceId: string }>();

app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || uuid();
  asyncLocalStorage.run({ traceId }, () => next());
});
```

## 성능 로깅

| 항목 | INFO 기준 | WARN 기준 |
|------|----------|----------|
| API 응답 시간 | 항상 기록 | > 1초 |
| 외부 서비스 호출 | 항상 기록 | > 1초 |
| DB 쿼리 | DEBUG에서 기록 | > 500ms |
| 배치 작업 | 시작/완료 기록 | 예상 시간 2배 초과 |

```kotlin
val startTime = System.currentTimeMillis()
val result = externalService.call(request)
val duration = System.currentTimeMillis() - startTime

if (duration > 1000) {
    logger.warn("외부 서비스 응답 지연: service={}, duration={}ms", serviceName, duration)
} else {
    logger.info("외부 서비스 호출 완료: service={}, duration={}ms", serviceName, duration)
}
```

## 로그 보관 정책

| 항목 | 기본값 | 비고 |
|------|--------|------|
| 보관 기간 | 90일 | 도메인별 상이 (금융: 5년 등) |
| 로테이션 | 일별 또는 100MB 초과 시 | |
| 압축 | 7일 이후 gzip 압축 | |
| 감사 로그 | 도메인 규정에 따름 | 별도 저장소 권장 |
