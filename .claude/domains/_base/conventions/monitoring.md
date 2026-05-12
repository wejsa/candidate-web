# 모니터링 컨벤션

모든 프로젝트에 적용되는 모니터링 규칙입니다.
도메인별 모니터링 요구사항(금융 거래 감시, 실시간 재고 추적 등)은 해당 도메인 문서를 참조하세요.

## RED 메서드 (서비스 모니터링)

모든 서비스는 RED 지표를 필수 수집합니다:

| 지표 | 설명 | 메트릭 타입 |
|------|------|------------|
| Rate | 초당 요청 수 (RPS) | Counter |
| Errors | 에러율 (5xx / total) | Counter |
| Duration | 응답 시간 (p50, p95, p99) | Histogram |

## USE 메서드 (인프라 모니터링)

| 지표 | 대상 | 경고 임계값 | 위험 임계값 |
|------|------|-----------|-----------|
| Utilization | CPU, 메모리, 디스크 | 80% | 90% |
| Saturation | 큐 길이, 스레드 풀 | 대기 발생 시 | 풀 고갈 시 |
| Errors | 하드웨어/네트워크 오류 | - | 발생 시 즉시 |

## 메트릭 네이밍

Prometheus 네이밍 규칙을 준수합니다:

| 규칙 | 예시 |
|------|------|
| 접두사: `{service}_{subsystem}` | `payment_api_` |
| 단위 접미사 | `_seconds`, `_bytes`, `_total` |
| Counter는 `_total` 접미사 | `http_requests_total` |
| snake_case | `request_duration_seconds` |

## 필수 메트릭

모든 서비스가 수집해야 하는 메트릭:

| 메트릭 | 타입 | 라벨 |
|--------|------|------|
| `http_requests_total` | Counter | method, path, status |
| `http_request_duration_seconds` | Histogram | method, path |
| `db_query_duration_seconds` | Histogram | query_type |
| `external_call_duration_seconds` | Histogram | service, endpoint |
| `active_connections` | Gauge | type (db, cache, mq) |

```kotlin
// Spring Boot + Micrometer 메트릭 수집
@Component
class MetricsInterceptor(private val meterRegistry: MeterRegistry) : HandlerInterceptor {

    override fun preHandle(request: HttpServletRequest, response: HttpServletResponse, handler: Any): Boolean {
        request.setAttribute("startTime", System.nanoTime())
        return true
    }

    override fun afterCompletion(request: HttpServletRequest, response: HttpServletResponse, handler: Any, ex: Exception?) {
        val startTime = request.getAttribute("startTime") as Long
        val duration = (System.nanoTime() - startTime) / 1_000_000_000.0

        meterRegistry.counter("http_requests_total",
            "method", request.method,
            "path", request.requestURI,
            "status", response.status.toString()
        ).increment()

        meterRegistry.timer("http_request_duration_seconds",
            "method", request.method,
            "path", request.requestURI
        ).record(Duration.ofNanos(System.nanoTime() - startTime))
    }
}
```

```typescript
// Node.js + prom-client 메트릭 수집
import { Counter, Histogram, Registry } from 'prom-client';

const register = new Registry();

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer({ method: req.method, path: req.path });
  res.on('finish', () => {
    end();
    httpRequestsTotal.inc({ method: req.method, path: req.path, status: res.statusCode.toString() });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

## 알림 규칙

| 심각도 | 조건 | 대응 시간 | 알림 채널 |
|--------|------|----------|----------|
| Critical | 에러율 > 5% (5분간) | 즉시 | PagerDuty + Slack |
| Critical | 서비스 다운 (헬스 체크 실패) | 즉시 | PagerDuty + Slack |
| Warning | 응답시간 p95 > 1초 (10분간) | 30분 내 | Slack |
| Warning | CPU/메모리 > 80% (15분간) | 30분 내 | Slack |
| Info | 일일 트래픽 변동 > 50% | 다음 업무 시 | Slack |

### 알림 피로 방지

| 규칙 | 설명 |
|------|------|
| 그룹핑 | 동일 원인 알림을 하나로 묶음 |
| 억제 (Inhibition) | Critical 발생 시 하위 Warning 억제 |
| 반복 간격 | 동일 알림 반복은 최소 1시간 간격 |
| Runbook 연결 | 모든 알림에 대응 절차 문서 링크 포함 |

## 헬스 체크 표준

| 엔드포인트 | 용도 | 실패 시 |
|-----------|------|---------|
| `/health` | 종합 상태 (외부 의존 포함) | 서비스 점검 필요 |
| `/health/live` | 프로세스 생존 (K8s liveness) | 컨테이너 재시작 |
| `/health/ready` | 요청 처리 가능 (K8s readiness) | 트래픽 제외 |

## 로그-메트릭-트레이스 연계

세 가지 관측 신호를 `traceId`로 연결합니다:

| 신호 | 도구 | traceId 연결 |
|------|------|-------------|
| 로그 | 구조화된 JSON 로그 | `traceId` 필드 (logging.md 참조) |
| 메트릭 | Prometheus + Grafana | Exemplar에 traceId 첨부 |
| 트레이스 | OpenTelemetry | 자동 전파 |

```kotlin
// OpenTelemetry 트레이스 연결 (Spring Boot)
@RestController
class PaymentController(private val paymentService: PaymentService) {

    @PostMapping("/payments")
    fun createPayment(@RequestBody request: PaymentRequest): ResponseEntity<Payment> {
        val span = Span.current()
        span.setAttribute("payment.amount", request.amount.toDouble())
        logger.info("결제 요청: traceId={}, amount={}", span.spanContext.traceId, request.amount)
        val result = paymentService.process(request)
        return ResponseEntity.ok(result)
    }
}
```

```typescript
// OpenTelemetry 트레이스 연결 (Node.js)
import { trace } from '@opentelemetry/api';

app.post('/payments', async (req, res) => {
  const span = trace.getActiveSpan();
  span?.setAttribute('payment.amount', req.body.amount);
  const traceId = span?.spanContext().traceId;
  logger.info('결제 요청', { traceId, amount: req.body.amount });
  const result = await paymentService.process(req.body);
  res.json(result);
});
```

## 대시보드 표준

모든 서비스에 다음 대시보드를 구성합니다:

| 대시보드 | 대상 | 주요 패널 |
|---------|------|----------|
| Overview | 서비스 전체 | RED 지표, 에러 Top 5, 인스턴스 상태 |
| API Detail | 엔드포인트별 | 응답시간 분포, 에러율, 처리량 |
| Infrastructure | 인프라 | CPU, 메모리, 디스크, 네트워크 |
| Business | 비즈니스 | 트랜잭션 수, 매출, 전환율 |
| Dependencies | 외부 의존성 | DB, 캐시, MQ 상태 및 지연시간 |
