# 관측(Observability) API

CANDID-027 — Prometheus 메트릭 + 헬스체크. 모든 엔드포인트는 `runtime='nodejs'`(prom-client/Prisma는 Node 전용) + `Cache-Control: no-store`.

## GET /api/health (liveness)

프로세스 생존 신호. **의존성 검사 없음** — 항상 200.

- 200: `{ "status": "ok", "uptime": <seconds>, "timestamp": "<ISO8601>" }`

> liveness를 DB에 묶지 않는다(일시 DB 장애로 컨테이너가 불필요하게 재시작되는 안티패턴 회피). DB 검사는 `/api/ready`.

## GET /api/ready (readiness)

트래픽 수용 준비 여부. DB 연결성(`SELECT 1`) probe.

- 200: `{ "status": "ready", "checks": { "db": "up" }, "timestamp": "<ISO8601>" }`
- 503: `{ "status": "unready", "checks": { "db": "down" }, "timestamp": "<ISO8601>" }`

> probe 실패는 throw가 아닌 503 정상 응답. 실패 로그는 DSN 누출 방지를 위해 `error.name`만 기록.

## GET /api/metrics (Prometheus scrape)

Prometheus exposition format 메트릭.

### 인증
- `METRICS_AUTH_TOKEN` 설정 시: `Authorization: Bearer <token>` 필요(상수 시간 비교). 불일치 → 403 `AUTH_FORBIDDEN`.
- 미설정 시: 비운영(open) / 운영(production)은 fail-closed(403).

### 응답
- 200: `Content-Type: text/plain; version=0.0.4; charset=utf-8`, 본문은 Prometheus 텍스트.

### 노출 지표
| 지표 | 타입 | 라벨 | 설명 |
|------|------|------|------|
| `candidate_business_event_total` | counter | `event`(signup/application_submit/application_withdraw/file_upload), `result`(success/failure) | 주요 비즈니스 이벤트 누적 횟수. 라우트 레이어에서 `withBusinessMetric`으로 계측(2xx=success/그외=failure). |

#### `candidate_business_event_total` 집계 규칙 (운영자 주의)
- **429(rate-limit) 제외**: rate-limit 거부는 비즈니스 결과가 아니므로 success/failure 어느 쪽으로도 집계하지 않는다(외부 IP-limit은 래퍼 진입 전 조기 반환되어 애초에 미집계 — 내부 user-limit 429도 동일하게 제외하여 일관).
- **멱등 재요청(application_submit)**: cache hit(2xx)도 success로 집계된다("성공 응답 served" 의미). 따라서 success 수 = 실제 신규 제출 수 + 멱등 재시도 수.
- **`file_upload`**: 바이너리 업로드가 아니라 `/files/resume/confirm`(업로드 확정) 시점에 집계된다.
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_class`(2xx~5xx) | HTTP 처리 시간. 버킷에 NFR 경계(0.3s 목록 / 0.8s 제출) 포함. `route`는 동적 세그먼트(id/uuid/지원번호/긴해시)가 `:id`로 정규화됨(카디널리티 억제). |
| Node 기본 지표 | (default) | — | heap/eventloop/gc 등 `collectDefaultMetrics`. |

### 요청 예시
```
curl -H "Authorization: Bearer $METRICS_AUTH_TOKEN" http://localhost:3000/api/metrics
```

### 운영 권고
- `/api/metrics`·`/api/ready`는 process 지표 등 인프라 정보를 노출하므로 인그레스/네트워크 정책으로 내부망·스크랩 IP로 제한 권장.
- `http_request_duration_seconds`의 `route` 라벨은 정규화되어 PII/식별자가 라벨로 영속화되지 않는다(이 코드베이스의 토큰은 query/body로만 전달).

## 배선
- `instrumentation.ts`의 `register()`가 Node 부팅 시 `wireHttpMetrics()`를 호출 → `withErrorHandler`의 요청 관측자로 `recordHttpRequest` 주입.
- `lib/errors/response.ts`는 universal(Edge middleware 그래프 포함)이라 prom-client를 직접 import하지 않고 콜백 훅(`setRequestObserver`)만 보유.
