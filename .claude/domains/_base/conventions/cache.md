# 캐시 컨벤션

모든 프로젝트에 적용되는 캐시 사용 규칙입니다.
도메인별 캐시 정책(금융 데이터 캐시 금지 항목, 상품 캐시 전략 등)은 해당 도메인 문서를 참조하세요.

## 캐시 키 네이밍

계층 구조를 사용하여 키 충돌을 방지합니다:

| 유형 | 패턴 | 예시 |
|------|------|------|
| 단건 엔티티 | `{service}:{entity}:{id}` | `user:profile:12345` |
| 목록/집합 | `{service}:{entity}:list:{filter}` | `product:list:category:electronics` |
| 세션 | `session:{sessionId}` | `session:abc-123-def` |
| 카운터 | `{service}:{entity}:count:{key}` | `order:daily:count:2026-02-19` |
| 락 | `lock:{resource}:{id}` | `lock:inventory:SKU-001` |

## TTL 전략

| 유형 | TTL | 예시 |
|------|-----|------|
| 참조 데이터 (거의 불변) | 24시간 | 카테고리 목록, 설정값 |
| 사용자 데이터 | 1시간 | 프로필, 선호도 |
| 세션 데이터 | 30분 | 로그인 세션 |
| 실시간 데이터 | 30초~5분 | 재고 수량, 순위 |

## 캐시 패턴

| 패턴 | 설명 | 사용 시점 |
|------|------|----------|
| Cache-Aside (Lazy Loading) | 캐시 미스 시 DB 조회 후 캐시 저장 | 기본 패턴 |
| Write-Through | 쓰기 시 캐시와 DB 동시 갱신 | 읽기/쓰기 일관성 필요 시 |
| Write-Behind | 캐시 먼저 쓰고 비동기로 DB 반영 | 쓰기 부하 분산 |

```kotlin
// Cache-Aside 패턴 (Spring Boot + Redis)
@Service
class UserService(
    private val redisTemplate: StringRedisTemplate,
    private val userRepository: UserRepository,
    private val objectMapper: ObjectMapper
) {
    fun getUser(userId: Long): User {
        val cacheKey = "user:profile:$userId"
        val cached = redisTemplate.opsForValue().get(cacheKey)
        if (cached != null) {
            return objectMapper.readValue(cached, User::class.java)
        }
        val user = userRepository.findById(userId)
            .orElseThrow { NotFoundException("USR-NOTFOUND-001") }
        redisTemplate.opsForValue().set(cacheKey, objectMapper.writeValueAsString(user), Duration.ofHours(1))
        return user
    }
}
```

```typescript
// Cache-Aside 패턴 (Node.js + ioredis)
import Redis from 'ioredis';

const redis = new Redis({ host: 'localhost', port: 6379 });

async function getUser(userId: string): Promise<User> {
  const cacheKey = `user:profile:${userId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as User;
  }
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundException('USR-NOTFOUND-001');
  await redis.set(cacheKey, JSON.stringify(user), 'EX', 3600);
  return user;
}
```

## 캐시 무효화 (Invalidation)

| 규칙 | 설명 |
|------|------|
| 이벤트 기반 무효화 | 상태 변경 시 즉시 해당 키 삭제 |
| KEYS 명령 금지 | 운영 환경에서 `KEYS *` 사용 절대 금지 (블로킹) |
| 패턴 삭제 | `SCAN` 기반으로 점진적 삭제 |
| 갱신 vs 삭제 | 삭제 후 Lazy Loading 권장 (갱신보다 안전) |

```kotlin
// 이벤트 기반 무효화
@Transactional
fun updateUser(userId: Long, request: UpdateUserRequest): User {
    val user = userRepository.save(user.apply { name = request.name })
    redisTemplate.delete("user:profile:$userId")  // 삭제 후 다음 조회 시 재캐싱
    return user
}
```

## 직렬화

| 포맷 | 사용 시점 | 비고 |
|------|----------|------|
| JSON | 기본 직렬화 | 가독성, 디버깅 용이 |
| MessagePack | 크기 민감 시 | JSON 대비 30~40% 절약 |
| Protobuf | 고성능 필요 시 | 스키마 관리 필요 |

## 연결 관리

| 항목 | 규칙 |
|------|------|
| 커넥션 풀 | 필수 사용 |
| Spring Boot | Lettuce (기본) — 비동기/논블로킹 |
| Node.js | ioredis — 클러스터/센티넬 지원 |
| 풀 크기 | 기본 8~16, 부하에 따라 조정 |
| 타임아웃 | 연결 3초, 명령 1초 |

## 장애 대응

| 상황 | 대응 |
|------|------|
| 캐시 미스 | DB 직접 조회 (fallback) |
| 캐시 서버 장애 | Circuit Breaker 적용 — DB 직접 조회로 전환 |
| 캐시 서버 복구 | 점진적 워밍업 (대량 캐시 미스 방지) |

```typescript
// Circuit Breaker 적용 (fallback to DB)
async function getUserWithFallback(userId: string): Promise<User> {
  try {
    const cached = await redis.get(`user:profile:${userId}`);
    if (cached) return JSON.parse(cached) as User;
  } catch (error) {
    logger.warn('캐시 서버 접근 실패, DB fallback', { userId, error: error.message });
  }
  return userRepository.findById(userId);
}
```

## Thundering Herd 방지

캐시 만료 시 다수 요청이 동시에 DB를 조회하는 것을 방지합니다:

| 전략 | 설명 |
|------|------|
| 분산 락 (Mutex) | 하나의 요청만 DB 조회, 나머지는 대기 |
| 확률적 갱신 | TTL 만료 전 확률적으로 미리 갱신 |
| 이중 TTL | 논리적 TTL + 물리적 TTL 분리 |

```kotlin
// 분산 락 기반 Thundering Herd 방지
fun getUserSafe(userId: Long): User {
    val cacheKey = "user:profile:$userId"
    val lockKey = "lock:user:profile:$userId"
    val cached = redisTemplate.opsForValue().get(cacheKey)
    if (cached != null) return objectMapper.readValue(cached, User::class.java)

    val acquired = redisTemplate.opsForValue()
        .setIfAbsent(lockKey, "1", Duration.ofSeconds(5)) ?: false
    if (acquired) {
        try {
            val user = userRepository.findById(userId).orElseThrow()
            redisTemplate.opsForValue().set(cacheKey, objectMapper.writeValueAsString(user), Duration.ofHours(1))
            return user
        } finally {
            redisTemplate.delete(lockKey)
        }
    }
    Thread.sleep(50)  // 락 획득 실패 시 짧은 대기 후 재시도
    return getUserSafe(userId)
}
```
