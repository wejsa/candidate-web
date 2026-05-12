# 테스팅 컨벤션

모든 프로젝트에 적용되는 테스트 작성 규칙입니다.
도메인별 테스트 요구사항은 해당 도메인 문서를 참조하세요.

## 테스트 피라미드

```
        ╱  E2E  ╲          ← 최소 (핵심 시나리오)
       ╱ 통합 테스트 ╲       ← 중간 (API, DB 연동)
      ╱  단위 테스트   ╲     ← 최대 (비즈니스 로직)
```

| 유형 | 범위 | 비율 |
|------|------|------|
| 단위 테스트 | 개별 함수/클래스 | 70% |
| 통합 테스트 | API, DB, 외부 서비스 연동 | 20% |
| E2E 테스트 | 전체 시나리오 | 10% |

## 테스트 파일 위치/네이밍

| 스택 | 위치 | 파일명 패턴 |
|------|------|------------|
| Spring Boot (Kotlin) | `src/test/kotlin/` | `{Class}Test.kt` |
| Spring Boot (Java) | `src/test/java/` | `{Class}Test.java` |
| Node.js (TypeScript) | `src/__tests__/` 또는 `*.test.ts` | `{module}.test.ts` |
| Go | 소스 동일 디렉토리 | `{file}_test.go` |

테스트 디렉토리는 소스와 동일한 패키지 구조를 미러링합니다.

## 테스트 메서드 네이밍

```kotlin
// Kotlin - 백틱 메서드명
@Test
fun `should_동작_when_조건`() { ... }

// 예시
@Test
fun `should_return_user_when_valid_id`() { ... }

@Test
fun `should_throw_exception_when_user_not_found`() { ... }
```

```typescript
// TypeScript - describe/it 패턴
describe('UserService', () => {
  it('should return user when valid id', () => { ... });
  it('should throw error when user not found', () => { ... });
});
```

```go
// Go - Test 접두사 + 설명
func TestGetUser_WhenValidId_ReturnsUser(t *testing.T) { ... }
func TestGetUser_WhenNotFound_ReturnsError(t *testing.T) { ... }
```

## 테스트 구조 (Given/When/Then)

```kotlin
@Test
fun `should_create_payment_when_valid_request`() {
    // Given - 사전 조건
    val request = CreatePaymentRequest(amount = 10000, method = "CARD")
    every { paymentRepository.save(any()) } returns payment

    // When - 실행
    val result = paymentService.create(request)

    // Then - 검증
    assertThat(result.status).isEqualTo(PaymentStatus.PENDING)
    verify(exactly = 1) { paymentRepository.save(any()) }
}
```

## 레이어별 커버리지 목표

| 레이어 | 목표 | 이유 |
|--------|------|------|
| Domain (Entity, VO) | 90% | 핵심 비즈니스 로직 |
| Application (Service) | 80% | 유즈케이스 로직 |
| API (Controller) | 70% | 입력 검증, 응답 변환 |
| Infrastructure | 60% | 외부 연동 (mock 한계) |
| **전체** | **80%** | **품질 게이트 기준** |

## Mock 전략

| 대상 | 전략 | 이유 |
|------|------|------|
| 외부 API | Mock | 네트워크 의존성 제거 |
| 외부 서비스 (PG, 메일 등) | Mock | 비용/속도/안정성 |
| DB | 테스트 컨테이너 또는 인메모리 DB | 실제 쿼리 검증 |
| 내부 서비스 | 가능하면 실제 사용 | 과도한 mock은 테스트 가치 저하 |

```kotlin
// 외부 의존성만 mock
@MockK lateinit var pgClient: PgClient        // 외부 PG 연동 → mock
@InjectMockKs lateinit var paymentService: PaymentService

// DB는 인메모리 또는 테스트 컨테이너
@DataJpaTest
class UserRepositoryTest {
    @Autowired lateinit var userRepository: UserRepository
    // 실제 H2/TestContainers 사용
}
```

## 테스트 데이터 관리

| 규칙 | 설명 |
|------|------|
| Factory 패턴 | 테스트 객체 생성 전용 팩토리 사용 |
| Fixture 분리 | 공통 테스트 데이터는 별도 파일로 분리 |
| 민감정보 제외 | 실제 카드번호, 개인정보 사용 금지 |
| 독립적 데이터 | 각 테스트는 자체 데이터 생성 |

```kotlin
// Factory 패턴 예시
object UserFixture {
    fun create(
        name: String = "테스트 사용자",
        email: String = "test@example.com",
        role: UserRole = UserRole.USER
    ) = User(name = name, email = email, role = role)
}
```

## 테스트 격리 원칙

| 원칙 | 설명 |
|------|------|
| 독립 실행 | 각 테스트는 다른 테스트에 의존하지 않음 |
| 순서 무관 | 실행 순서와 관계없이 동일한 결과 |
| DB 롤백 | `@Transactional`로 테스트 후 롤백 (Spring) |
| 상태 정리 | 외부 리소스(파일, 캐시) 테스트 후 정리 |

## 주석 처리된 코드 금지

테스트 파일에서 assertion/검증 코드를 주석 처리하면 빌드 게이트를 우회합니다.
컴파일되지 않는 코드는 존재하지 않는 메서드 호출 등 오류를 숨길 수 있습니다.

| 규칙 | 설명 |
|------|------|
| 주석 처리 금지 | assertion, verify 등 검증 코드를 주석으로 남기지 않음 |
| 삭제 또는 활성화 | 불필요하면 삭제, 필요하면 활성화하여 빌드 검증 대상에 포함 |

## 스택별 테스트 실행 명령

| 스택 | 전체 테스트 | 단위 테스트 | 커버리지 |
|------|-----------|-----------|---------|
| Spring Boot (Gradle) | `./gradlew test` | `./gradlew test --tests '*UnitTest*'` | `./gradlew jacocoTestReport` |
| Node.js | `npm test` | `npm run test:unit` | `npm run test:coverage` |
| Go | `go test ./...` | `go test ./internal/...` | `go test -coverprofile=coverage.out ./...` |
