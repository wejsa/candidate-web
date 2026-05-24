# CANDID-036 회고 — CANDID-010 FU1: 이메일 인증 보안 hardening

## 기본 정보

| 항목 | 값 |
|------|------|
| Task ID | CANDID-036 |
| 제목 | 이메일 인증 보안 hardening (race + RL + 메일링크 + 회귀 가드) |
| Phase | 2 · Priority high · Depends on CANDID-010 (done) |
| 시작 (claim) | 2026-05-23T23:23 (3199ba8) |
| 완료 (Step 3 머지 + 완료 처리) | 2026-05-24T00:37 (02d0371) |
| **총 소요 시간** | **약 75분** |
| 스텝 수 | 3 (Foundation / Race fix / 라우터 적용) |
| PR 수 | 3 (#35, #36, #37) — 자기 PR 100% |
| 출처 | CANDID-010 회고 carry MAJOR 14건 + PR #34 MINOR 6건 (10건 본 task 처리, 3건 분리) |

## 변경 규모

| Step | PR | 변경량 | 예상 | 정확도 |
|:----:|:---:|------:|-----:|:------:|
| 1 | #35 | +461/-9 | 500 | -8% |
| 2 | #36 | +259/-100 | 450 | -42% (replace 패턴) |
| 3 | #37 | +212/-73 | 550 | -62% (헬퍼 적용 효과) |
| **총합** | — | **+932/-182** | 1,500 | -38% (예상 대비 작음) |

> 모든 스텝이 예상 대비 작음 — 헬퍼 추출/replace 패턴이 라인 inflation을 줄임. **추정 모델 보정 필요**.

## 1. Speed 분석

- **머지 간격**: claim → Step 1 머지 52분, Step 1 → Step 2 11분, Step 2 → Step 3 12분
- **자기 PR + COMMENT 처리** → 리뷰 대기 0
- **병목**: Step 1 (52분) — 5개 신규 파일 (마이그레이션 + 헬퍼 모듈 + 신규 정책 + 단위 테스트 2건). 가장 인프라적 비중
- **Step 2/3 빠름**: Step 1 인프라 활용으로 helper 호출만 추가, 라인 감소

## 2. Quality 분석

| 지표 | Step 1 (#35) | Step 2 (#36) | Step 3 (#37) |
|------|:------:|:------:|:------:|
| CRITICAL | 0 | 0 | 0 |
| MAJOR (전 관점 통합) | 0* | 9 | 8 |
| MINOR | 6 | 8 | 7 |
| 첫 리뷰 통과 | ✅ | ✅ | ✅ |
| auto-fix 루프 | 0회 | 0회 | 0회 |
| 리뷰 방식 | 직접 (서브에이전트 한도) | 3-agent | 3-agent |

> *Step 1은 서브에이전트 한도 도달로 메인 컨텍스트 직접 리뷰 — MAJOR 0건은 직접 분석 한계 가능성.

### 핵심 관찰
- **CRITICAL 0건 일관** — 인프라 단계의 사전 설계(plan)와 db-designer 권고 통합이 효과적
- **MAJOR 누적 17건** (Step 2 9건 + Step 3 8건) → **L-022 임계 초과 → 별도 task로 carry-over** (의도된 분리)
- **carry 결정의 정당성**: 본 PR에서 즉시 fix하면 inflation + 검토 비대화. L-022 적용 첫 사례.

## 3. Patterns 분석

### 반복된 이슈 유형
| 유형 | 발생 step | 비고 |
|------|----------|------|
| P2002 매핑이 meta.target 검증 없음 | Step 2 → Step 3 carry | 도메인/보안 양쪽 지적 |
| 외부 wrapper의 inner 응답 헤더 override | Step 3 신규 발견 | 본 PR 발생, 후속 task 분리 |
| 테스트 mock 환경의 atomicity 한계 | Step 2/3 모두 | testcontainers Postgres 통합 권장 |
| 라인 추정 정확도 (예상 > 실제) | 3 step 모두 | 헬퍼 활용으로 라인 감소 |

### 자주 수정된 파일
- `lib/security/rate-limit.ts` — Step 1 + Step 3 (RL 정책 + helper) 
- `lib/auth/email-verification.ts` — Step 2 (race fix)
- `app/api/v1/auth/{signup,resend,verify-email}/route.ts` — Step 3 (헬퍼 적용 + RL 부착)

### 스킬 실행 순서
정상 자동 체이닝 — plan → impl → review → merge × 3, 중단 없음.
auto-fix loop 미사용 (CRITICAL 0).

## 4. Decisions 분석

| 결정 | 트레이드오프 | 결과 |
|------|-------------|------|
| **db-designer Option C** (`updateMany WHERE`) | 코드만 변경 vs DB 마이그레이션 | 채택 — Option A(token_hash 부분 UNIQUE)는 race 차단 무효라는 정정 후 |
| **부분 UNIQUE 마이그레이션** (`(user_id) WHERE consumed_at IS NULL`) | resend TOCTOU race deep defense vs schema 변경 부담 | 채택 — race 시 P2002 → AUTH_VERIFICATION_RESEND_COOLDOWN 매핑 |
| **`UserRateLimitPolicy` 별도 인터페이스** | 시그니처 변경 최소 vs 책임 분리 | 옵션 B (별도 helper 신설) 채택 — withRateLimit 시그니처 보존 |
| **withUserRateLimit IIFE 호출** (`(req, ctx)`) | inner 호출이 명시적 vs wrapper 패턴 비일관 | 채택 + MAJOR carry-over (`enforceUserRateLimit` 인라인 헬퍼 권장) |
| **carry MAJOR 17건 분리** (L-022 적용) | 단일 PR inflation 회피 vs follow-up 부담 | 분리 채택 — L-022 첫 적용 사례 |

### 기술 부채 (CANDID-036 FU로 carry)
- **H001** RL wrapper 헤더 override (외부 → inner 덮어쓰기)
- **H001 (P2002)** `meta.target` 검증으로 정밀 매핑
- **H003** 이미 인증된 사용자 race 시 cooldown
- **H004** `isPrismaUniqueViolation`을 `lib/prisma/errors.ts`로 추출 (cross-cutting concern)
- **H006~H009** 테스트 강화 (race Promise.all, PrismaClientKnownRequestError instance, testcontainers Postgres, 윈도우 경계값, 호출 도달 검증)
- **H002 (user-bucket UX)** 3회/시간 + 60s cooldown 결합 시 57분 lockout 가능 (운영 메트릭 후 조정)

## 5. Lessons

### Keep (이번에 잘된 점)
- **db-designer 백그라운드 호출 (L-012)** — Option A의 race 차단 무효라는 정정을 통해 잘못된 마이그레이션 방지. plan 작성 직후 결과 통합으로 동선 효율
- **L-022 (carry 임계) 첫 적용** — Step 2/3 carry 17건을 본 PR에서 fix 안 하고 분리. 라인 inflation 방지 + 검토 비대화 차단
- **pii-safe 헬퍼 횡단 추출** — Step 1에 만들고 Step 3에서 일관 적용. PR #34 carry M001~M003을 영구 봉쇄
- **메인 직접 리뷰 폴백 (Step 1)** — 서브에이전트 한도 도달 시 흐름 중단 없이 진행. CLAUDE.md "subagent 타임아웃 → 스킵 후 진행" 정책 효과
- **부분 UNIQUE deep defense 패턴** — race를 P2002 → 비즈니스 에러 매핑으로 자연 차단. SELECT FOR UPDATE 우회 필요 없음
- **L-001 destructive guard 마이그레이션** — `DO $$ COUNT > 0 RAISE EXCEPTION` 사전 점검으로 비정상 데이터 마이그레이션 차단

### Improve (개선 필요)
- **라인 추정 정확도** — 3 step 모두 -8 ~ -62% under. 헬퍼 추출/replace 패턴 효과를 추정 모델에 반영 필요. **L-010 보강 후보**
- **wrapper 합성 패턴 비일관** — `withRateLimit` (외부) + `withUserRateLimit(...)(req, ctx)` (inner IIFE) 혼재. `enforceUserRateLimit` 인라인 헬퍼로 통일 권장
- **테스트 mock atomicity 한계** — Step 2 트랜잭션 롤백/race가 mock 한정 검증. 실제 race 보장은 testcontainers Postgres 통합 테스트 필요 (별도 task 권장)
- **외부 wrapper override가 user-bucket 정보 손실** — Step 3 신규 발견. 표준 backoff(RFC 6585) 측면에서 inner의 user-bucket 정보가 더 유용

### Learn (신규 학습 항목 후보)
- **L-023 후보**: wrapper 합성 시 inner 응답 헤더 보호 — 외부 wrapper는 inner가 이미 RL 헤더를 부착했으면 덮어쓰지 않아야 함 (`X-RateLimit-Policy` 우선순위)
- **L-024 후보**: PostgreSQL UPDATE의 자동 row-level lock으로 race 차단 가능 — `updateMany WHERE 조건` 패턴이 별도 SELECT FOR UPDATE 없이도 직렬화 보장 (Prisma idiomatic)
- **L-025 후보**: 부분 UNIQUE 제약을 비즈니스 race 방어 시맨틱으로 사용 — `(user_id) WHERE consumed_at IS NULL` 같은 부분 UNIQUE가 P2002 → 비즈니스 에러로 매핑되어 deep defense

### Try (다음 task에서 시도)
- 다음 wrapper 합성 시 **`enforceUserRateLimit` 인라인 헬퍼** 시도
- **testcontainers Postgres** 통합 테스트 도입 (race 실제 검증)
- 라인 추정 시 **헬퍼 추출 보정 계수** 0.6~0.8 적용 (replace 패턴 예상)

## 6. Action Items

| 우선순위 | 항목 | 담당 |
|---------|------|------|
| 즉시 | **CANDID-036 FU 신설** — carry MAJOR 17건 통합 (RL wrapper override + P2002 meta.target + lib/prisma/errors.ts 추출 + 테스트 강화) | PM/사용자 |
| 단기 | H002 user-bucket UX 메트릭 관찰 → 한도 조정 검토 | 운영 |
| 단기 | L-023/L-024/L-025 lessons-learned 추가 | retro |
| 중기 | CANDID-026 (감사 로그 AOP) — H007 audit event 통합 | PM |
| 중기 | CANDID-029 (야간 배치) — H008 email_verifications cleanup 통합 | PM |
| 중기 | testcontainers Postgres 통합 테스트 인프라 | 인프라 |

## 7. 메트릭 요약

| 메트릭 | 값 |
|--------|------|
| 총 변경량 | +932/-182 |
| PR 수 | 3 (자기 PR 100%) |
| CRITICAL 발생 횟수 | 0 |
| MAJOR 누적 (carry-over) | 17건 → 본 PR 0건, 분리 17건 |
| 첫 리뷰 통과율 | 3/3 = 100% |
| auto-fix loop 사용 | 0회 (CRITICAL 0) |
| 라인 추정 정확도 | -38% over (예상 대비 작음) |
| 신규 테스트 추가 | 36 cases (단위 26 + 라우터 통합 10) |
| 전체 테스트 | 549 pass, typecheck 0, ESLint 0 |
| 소요 시간 | 75분 (claim → 완료 처리) |

## 8. CANDID-010 회고 → CANDID-036 처리율

| Carry 항목 | 본 task 처리 | 비고 |
|----------|:----------:|------|
| H001/H009 race window | ✅ Step 2 (updateMany) | |
| H004 user-bucket RL | ✅ Step 1/3 (USER_POLICIES) | |
| H005 verify-email RL | ✅ Step 1/3 (POLICIES.VERIFY_EMAIL) | |
| H010~H014 테스트 가드 | ✅ Step 2/3 (회귀 5건) | |
| M001~M006 logging 강화 | ✅ Step 1/3 (pii-safe) | |
| H006 메일 링크 GET | ⏸️ 분리 | `app/auth/` 부재로 별도 task |
| H007 audit event | ⏸️ 분리 | CANDID-026 통합 |
| H008 cleanup cron | ⏸️ 분리 | CANDID-029 통합 |

**처리율: 11/14 (79%) + 3건 다른 task로 매핑** = 100% 추적 완료.

---

🤖 Generated by skill-retro v2 — 2026-05-24
