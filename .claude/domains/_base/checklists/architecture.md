# 아키텍처 체크리스트

모든 도메인에 적용되는 아키텍처 패턴 및 설계 품질 체크리스트입니다.

## 설계 패턴

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 패턴 일관성 | 동일 문제에 동일 패턴 적용 | MAJOR |
| 패턴 적합성 | 문제에 적합한 패턴 선택 | MAJOR |
| 과도한 추상화 | 불필요한 추상화 계층 금지 | MINOR |
| 단일 책임 | 클래스/모듈당 하나의 책임 | MAJOR |

## 장애 격리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| Circuit Breaker | 외부 서비스 호출 시 서킷 브레이커 적용 | HIGH |
| Timeout 설정 | 모든 외부 호출에 타임아웃 설정 | HIGH |
| Retry 정책 | 재시도 시 지수 백오프 적용 | HIGH |
| Fallback | 장애 시 대체 로직 제공 | MEDIUM |
| Bulkhead | 리소스 풀 격리로 장애 전파 방지 | MEDIUM |

```kotlin
// Circuit Breaker 예시 (Resilience4j)
@CircuitBreaker(name = "externalService", fallbackMethod = "fallback")
@Retry(name = "externalService")
@Timeout(name = "externalService")
suspend fun callExternalService(): Response {
    return webClient.get().retrieve().awaitBody()
}

fun fallback(e: Exception): Response {
    logger.warn("Fallback triggered: ${e.message}")
    return Response.empty()
}
```

## 분산 시스템 패턴

| 항목 | 설명 | 심각도 |
|------|------|--------|
| Saga 패턴 | 분산 트랜잭션 시 보상 트랜잭션 구현 | HIGH |
| 이벤트 소싱 | 상태 변경 이력 추적 필요 시 적용 | MEDIUM |
| CQRS | 읽기/쓰기 분리 필요 시 적용 | MEDIUM |
| 멱등성 | 중복 요청 시 동일 결과 보장 | HIGH |

```kotlin
// Saga 패턴 예시 - 보상 트랜잭션
class PaymentSaga {
    suspend fun execute(order: Order): SagaResult {
        try {
            // Step 1: 재고 차감
            val inventoryResult = inventoryService.reserve(order.items)

            // Step 2: 결제 처리
            val paymentResult = paymentService.process(order.payment)
            if (paymentResult.isFailed()) {
                // 보상 트랜잭션: 재고 복원
                inventoryService.release(inventoryResult.reservationId)
                return SagaResult.failed(paymentResult.error)
            }

            // Step 3: 주문 확정
            return orderService.confirm(order.id)
        } catch (e: Exception) {
            // 전체 롤백
            compensate(order)
            throw e
        }
    }
}
```

## 확장성

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 수평 확장 | Stateless 설계로 인스턴스 추가 가능 | HIGH |
| 세션 관리 | 로컬 세션 저장 금지 (Redis 등 외부 저장소 사용) | HIGH |
| 파일 저장 | 로컬 파일시스템 사용 금지 (S3 등 외부 저장소 사용) | HIGH |
| 병목 지점 | 단일 장애 지점 없음 | HIGH |

## 의존성 관리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 계층 분리 | Domain → Application → Infrastructure 방향만 의존 | HIGH |
| 포트/어댑터 | 외부 의존성은 인터페이스로 추상화 | MEDIUM |
| 순환 의존 | 패키지/모듈 간 순환 의존 금지 | CRITICAL |
| DI 활용 | 의존성 주입으로 결합도 낮춤 | MEDIUM |

```
# 계층 의존 방향
┌─────────────────────────────────────┐
│           Presentation              │  API, Controller
├─────────────────────────────────────┤
│           Application               │  Service, UseCase
├─────────────────────────────────────┤
│             Domain                  │  Entity, Repository Interface
├─────────────────────────────────────┤
│          Infrastructure             │  Repository Impl, External
└─────────────────────────────────────┘
         의존 방향: ↓ (아래로만)
```

## 비동기 처리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 블로킹 호출 금지 | WebFlux에서 block() 사용 금지 | CRITICAL |
| 스레드 풀 분리 | I/O 작업은 별도 스레드 풀 사용 | HIGH |
| 백프레셔 | 과부하 시 처리량 조절 | MEDIUM |
| 이벤트 기반 | 동기 호출 대신 이벤트 발행 고려 | MEDIUM |
| Python: async 일관성 | async 라우터에서 sync DB 호출 금지 (이벤트 루프 블로킹) | CRITICAL |
| Python: context manager | SQLAlchemy 세션은 `async with session:` 필수 | CRITICAL |
| Python: CPU 작업 | CPU 바운드는 `run_in_executor` 사용 | HIGH |

## Python 아키텍처

`.py` 파일 변경 시 추가 확인:

| 항목 | 설명 | 심각도 |
|------|------|--------|
| FastAPI response_model | API 응답에 Pydantic 모델 필수, dict 반환 금지 | CRITICAL |
| FastAPI Depends | DB/인증은 `Depends()` 패턴 사용, 전역 인스턴스 금지 | HIGH |
| Pydantic 스키마 분리 | Create/Response/Update 용도별 분리 | MAJOR |
| Django views 얇게 | views.py에 비즈니스 로직 금지, services.py 분리 | HIGH |
| Django 앱 간 참조 | 앱 간 import는 services 레이어에서만 | MAJOR |
| 환경설정 | `pydantic-settings` 사용, `os.environ` 직접 접근 금지 | MAJOR |

## API 설계

| 항목 | 설명 | 심각도 |
|------|------|--------|
| RESTful | REST 원칙 준수 | MEDIUM |
| 버전 관리 | API 버전 명시 (/v1, /v2) | MEDIUM |
| 페이지네이션 | 목록 조회 시 페이징 적용 | MEDIUM |
| HATEOAS | 필요 시 하이퍼미디어 링크 제공 | LOW |

## 사용 방법

이 체크리스트는 `skill-review`, `skill-review-pr` 실행 시 자동으로 로드됩니다.
도메인별 체크리스트와 병합되며, 도메인 설정이 우선합니다.
