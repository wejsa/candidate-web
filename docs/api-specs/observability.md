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

## 야간 정리 배치 (CANDID-029)

외부 스케줄러(cron / k8s CronJob / GitHub Actions)가 트리거하는 Node CLI 배치입니다.
엔트리포인트 `scripts/batch/nightly-cleanup.ts`(tsx). 로직은 `lib/batch/*` — `'server-only'`를 import하지 않고
PrismaClient·S3 삭제기·mailer를 주입(DI)받아 CLI 컨텍스트에서 동작합니다.

### 실행
```
pnpm batch:nightly
```

### 정리 태스크 (순차, 태스크별 격리)
| 태스크 | 대상 | 동작 |
|--------|------|------|
| `expired-email-verifications` | `email_verifications` | `EMAIL_VERIFICATION_RETENTION_DAYS`(7)일 경과 consumed/expired 행 삭제 |
| `expired-password-reset-tokens` | `password_reset_tokens` | `expiresAt < now` 삭제 |
| `expired-idempotency-keys` | `idempotency_keys` | `expiresAt < now` 삭제 |
| `stale-drafts` | `application_drafts` + 첨부 | `lastSavedAt < now-DRAFT_RETENTION_DAYS`(30) — S3 객체 선삭제 → resume_files row 삭제 → draft 삭제(BR-FILE-06) |
| `pending-virus-scans` | `resume_files` (PENDING) | 스캔 판정 → CLEAN/FAILED 상태 갱신. INFECTED는 악성 파일(S3) 삭제 + row를 INFECTED로 보존(audit) + 소유자 알림(BR-FILE-04) |

> 토큰/멱등성 테이블은 PII 컬럼이 없는 운영 위생 대상입니다. BR-PII-03/04 PII 자동 파기(User/Application 스냅샷)는 별도 범위.
> ClamAV는 **골격**입니다 — `CLAMAV_ENABLED=false`(기본) 또는 미구현 시 스캔은 `SKIPPED`(PENDING 유지, 임의 CLEAN 처리 안 함). 실제 clamd 클라이언트는 후속 작업.

### Exit Code
| 코드 | 의미 |
|-----|-----|
| 0 | 모든 태스크 성공 |
| 1 | 1개 이상 태스크 실패(부분 실패 포함) 또는 치명적 오류 |

### 관련 환경변수
| 변수 | 기본 | 설명 |
|------|------|------|
| `EMAIL_VERIFICATION_RETENTION_DAYS` | 7 | 이메일 인증 행 보존 일수 |
| `DRAFT_RETENTION_DAYS` | 30 | 미제출 Draft 보존 일수 |
| `BATCH_DELETE_CHUNK` | 1000 | 청크 페이지네이션 크기(최대 10000) |
| `CLAMAV_ENABLED` / `CLAMAV_HOST` / `CLAMAV_PORT` | false / — / — | 바이러스 스캔(골격) |

### 안전성
- 태스크별 **격리 실행** — 한 태스크 실패가 나머지를 중단시키지 않음(`runNightlyCleanup`).
- 모든 정리는 **멱등**(재실행 안전), 대량 삭제는 청크/cursor 페이지네이션.
- 에러는 PII 누출 방지를 위해 `ErrorName(PrismaCode)`만 기록(BR-PII-02). 로그/메일에 원본 파일명은 escape.
- 배치 PrismaClient는 `connect_timeout`/`socket_timeout` 보수적 부여로 cron hang/중첩 방지.
