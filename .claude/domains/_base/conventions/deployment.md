# 배포 컨벤션

모든 프로젝트에 적용되는 배포 규칙입니다.
도메인별 배포 요구사항(금융 규제 준수 배포, 트래픽 피크 대응 등)은 해당 도메인 문서를 참조하세요.

## 환경 구분

| 환경 | 목적 | 데이터 | 접근 |
|------|------|--------|------|
| local | 개발 | 로컬 DB | 개발자 |
| dev | 통합 테스트 | 테스트 데이터 | 개발팀 |
| staging | 릴리스 검증 | 운영 유사 데이터 | 개발팀 + QA |
| production | 운영 | 실제 데이터 | 운영팀 (승인 필수) |

## 환경 변수

| 규칙 | 설명 |
|------|------|
| 12-Factor App | 설정은 환경변수로 주입 |
| Secret 관리 | Secret Manager 사용 (하드코딩 절대 금지) |
| .env Git 제외 | `.gitignore`에 `.env` 필수 등록 |
| .env.example | 필요한 변수 목록을 문서화 |

```bash
# .env.example (Git에 포함)
DATABASE_URL=postgresql://localhost:5432/myapp
REDIS_URL=redis://localhost:6379
JWT_SECRET=       # Secret Manager에서 주입
API_KEY=          # Secret Manager에서 주입
LOG_LEVEL=info
```

```kotlin
// Spring Boot - 환경별 설정 분리
// application.yml (공통)
spring:
  profiles:
    active: ${SPRING_PROFILES_ACTIVE:local}

// application-local.yml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/myapp

// application-production.yml
spring:
  datasource:
    url: ${DATABASE_URL}
```

```typescript
// Node.js - 환경변수 로딩
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['local', 'dev', 'staging', 'production']),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
});

export const env = envSchema.parse(process.env);
```

## Docker 컨벤션

| 항목 | 규칙 |
|------|------|
| 멀티스테이지 빌드 | 빌드 이미지와 런타임 이미지 분리 |
| non-root 실행 | `USER appuser` (root 실행 금지) |
| .dockerignore | `node_modules`, `.git`, `.env` 등 제외 |
| 이미지 태그 | `{version}-{commit-sha-short}` |
| 베이스 이미지 | 공식 이미지 + 특정 버전 고정 |

```dockerfile
# 멀티스테이지 빌드 (Node.js)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

## CI/CD 파이프라인 표준

| 단계 | 내용 | 실패 시 |
|------|------|---------|
| Build | 컴파일 + 의존성 설치 | 파이프라인 중단 |
| Test | 단위/통합 테스트 | 파이프라인 중단 |
| Scan | 보안 취약점 스캔 (SAST/SCA) | Critical 시 중단 |
| Package | Docker 이미지 빌드 + 레지스트리 Push | 파이프라인 중단 |
| Deploy | 환경별 배포 | 자동 롤백 |

```yaml
# GitHub Actions 파이프라인 예시
name: CI/CD
on:
  push:
    branches: [main]

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: npm ci && npm run build
      - name: Test
        run: npm test -- --coverage
      - name: Security Scan
        run: npm audit --audit-level=critical

  deploy:
    needs: build-test
    runs-on: ubuntu-latest
    steps:
      - name: Build & Push Docker Image
        run: |
          docker build -t myapp:${{ github.sha }} .
          docker push registry/myapp:${{ github.sha }}
      - name: Deploy to Production
        run: kubectl set image deployment/myapp myapp=registry/myapp:${{ github.sha }}
```

## 배포 전략

| 전략 | 설명 | 사용 시점 |
|------|------|----------|
| Rolling | 인스턴스 순차 교체 (무중단) | 기본 전략 |
| Blue-Green | 새 환경 준비 후 트래픽 전환 | 즉시 롤백 필요 시 |
| Canary | 일부 트래픽만 새 버전으로 | 점진적 검증 필요 시 |

| 항목 | Rolling | Blue-Green | Canary |
|------|---------|------------|--------|
| 롤백 속도 | 중간 | 즉시 | 즉시 |
| 리소스 비용 | 낮음 | 2배 | 중간 |
| 검증 수준 | 기본 | 전환 전 검증 | 점진적 검증 |

## 헬스 체크

| 엔드포인트 | 용도 | 응답 |
|-----------|------|------|
| `/health` | 종합 상태 | 의존 서비스 포함 |
| `/health/live` | K8s Liveness | 프로세스 생존 여부 |
| `/health/ready` | K8s Readiness | 요청 처리 가능 여부 |

```kotlin
// Spring Boot Actuator 헬스 체크
@Component
class CustomHealthIndicator(
    private val redisTemplate: StringRedisTemplate,
    private val dataSource: DataSource
) : HealthIndicator {

    override fun health(): Health {
        val dbHealthy = checkDatabase()
        val redisHealthy = checkRedis()
        return if (dbHealthy && redisHealthy) {
            Health.up().withDetail("db", "UP").withDetail("redis", "UP").build()
        } else {
            Health.down().withDetail("db", if (dbHealthy) "UP" else "DOWN")
                .withDetail("redis", if (redisHealthy) "UP" else "DOWN").build()
        }
    }
}
```

```typescript
// Express 헬스 체크
app.get('/health', async (req, res) => {
  const checks = {
    db: await checkDatabase(),
    redis: await checkRedis(),
  };
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'UP' : 'DOWN', checks });
});

app.get('/health/live', (req, res) => res.json({ status: 'UP' }));
app.get('/health/ready', async (req, res) => {
  const ready = await checkDatabase();
  res.status(ready ? 200 : 503).json({ status: ready ? 'UP' : 'DOWN' });
});
```

## 롤백 절차

| 규칙 | 설명 |
|------|------|
| 이미지 기반 롤백 | 이전 버전 이미지로 즉시 롤백 |
| DB 마이그레이션 호환 | 롤백 시에도 이전 스키마와 호환 (backward-compatible) |
| 롤백 테스트 | 배포 전 롤백 시나리오 검증 |
| 자동 롤백 | 헬스 체크 실패 시 자동 롤백 (K8s rollout undo) |

```bash
# K8s 수동 롤백
kubectl rollout undo deployment/myapp
kubectl rollout status deployment/myapp
```
