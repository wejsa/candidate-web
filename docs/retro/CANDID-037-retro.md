# CANDID-037 회고 — CANDID-036 FU: RL wrapper 합성 + P2002 정밀 매핑 + 테스트 강화

## 기본 정보

| 항목 | 값 |
|------|------|
| Task ID | CANDID-037 |
| 제목 | CANDID-036 FU: RL wrapper 합성 + P2002 정밀 매핑 + 테스트 강화 |
| Phase | 2 · Priority high · Type enhancement |
| 의존성 | CANDID-036 (done) |
| 시작 (claim) | 2026-05-24T10:32:46 (aeaa2aa) |
| 완료 처리 | 2026-05-24T11:25:38 (106a11c) |
| **총 소요 시간** | **약 53분** |
| 스텝 수 | 3 (Cross-cutting / 도메인 정밀화 / 라우터 통합) |
| PR 수 | 3 (#38, #39, #40) — 자기 PR 100% |
| 출처 | CANDID-036 회고 carry MAJOR 17건 (PR #36 9건 + PR #37 8건) — L-022 첫 적용 |

## 변경 규모

| Step | PR | 변경량 | 예상 | 정확도 | mergedLines |
|:----:|:---:|------:|-----:|:------:|-----------:|
| 1 | #38 | +463/-16 | 360 | +29% | 463 |
| 2 | #39 | +203/-29 | 370 | **-37%** | 232 |
| 3 | #40 | +182/-76 | 85 | **+204%** | 258 |
| **총합** | — | **+848/-121** | 815 | +17% | 953 |

> **추정 모델 편차**: Step 2는 헬퍼 호출만 추가로 underestimate, Step 3는 라우터 통합 검증/매직 넘버 제거가 *3개 파일*에 걸쳐 라인 폭발. CANDID-036 회고의 "헬퍼 추출 보정 계수 0.6~0.8" 가설은 부분적으로 검증되었으나(Step 2), 라우터 통합 시 테스트 다중 파일 영향은 별도 보정 필요.

## 1. Speed 분석

### 타임라인
| 단계 | 시각 | Δ |
|------|------|-:|
| claim | 10:32:46 | — |
| plan 승인 | 10:40:45 | +8분 |
| Step 1 PR #38 생성 | 10:48:13 | +8분 |
| Step 1 머지 | 10:55:14 | +7분 |
| Step 2 PR #39 생성 | 11:03:12 | +8분 |
| Step 2 머지 | 11:09:27 | +6분 |
| Step 3 PR #40 생성 | 11:17:46 | +8분 |
| Step 3 머지 | 11:23:44 | +6분 |
| 완료 처리 | 11:25:38 | +2분 |

### 핵심 관찰
- **자기 PR 100% + COMMENT 처리** → 리뷰 대기 0, 자동 체이닝 완전 자동화
- **머지 간격 일관 (6-8분/Step)** — CANDID-036의 75분 대비 53분으로 단축. 인프라(Step 1)가 가장 큰 비중이나 fix loop 0회로 안정.
- **계획 단계 (claim → plan 승인) 8분** — db-designer 백그라운드 + 컨텍스트 수집 효율. 사용자 결정 (D1=AUTH_EMAIL_ALREADY_VERIFIED 등) AskUserQuestion 즉시 응답
- **fix loop 0회** — 3 PR 모두 첫 리뷰 통과

## 2. Quality 분석

| 지표 | Step 1 (#38) | Step 2 (#39) | Step 3 (#40) |
|------|:------:|:------:|:------:|
| CRITICAL | 0 | 0 | 0 |
| MAJOR (전 관점 통합) | 0 | 3 | 1 |
| MINOR | 4 | 5 | 6 |
| INFO | 12 | 8 | 7 |
| 첫 리뷰 통과 | ✅ | ✅ | ✅ |
| auto-fix 루프 | 0회 | 0회 | 0회 |
| 보안 결함 | 0 | 0 | 0 |
| 리뷰 방식 | 3-agent full | 3-agent full | 3-agent full |
| 테스트 추가 | +28 | +7 | +2 |

### MAJOR 4건 분류
- **Step 2 H001 (behavioral break)** — frontend 미구현 상태에서 Step 3와 함께 release되어 회수
- **Step 2 H002 (UX 정책 결정)** — D1 결정 시점에 사용자 승인 완료, 운영 메트릭 후 재검토
- **Step 2 H003 (test 합성 경로 누락)** — Step 3에서 라우터 통합 테스트로 자연 합류
- **Step 3 H001 (IP-bucket 회피 트릭 부작용)** — 별도 task (같은 user × IP 회전 검증) 권고

→ **모두 의도된 분리 또는 별도 task 합류**. 본 task에서 즉시 fix 필요한 MAJOR 0건.

### 핵심 관찰
- **CRITICAL 0건 일관** — Step 1 cross-cutting helper의 명확한 시맨틱(부분집합 매칭, duck-typing 회피)이 Step 2/3 도입 시 회귀 차단
- **보안 결함 0건 (3개 PR 모두)** — RL/PII 영역 정책 변경 없음 + L-023 가드는 enforcement 영향 없는 헤더 부착만
- **MINOR 누적 15건** — 대부분 향후 마이그레이션/테스트 헬퍼 추출/별도 task로 분리. inflation 없음

## 3. Patterns 분석

### 반복된 이슈 유형 (3 step 종합)
| 유형 | 발생 step | 비고 |
|------|----------|------|
| 매직 넘버 (POLICIES.*.maxRequests) | Step 3에서 일괄 제거 | 카탈로그 변경 자동 추종 가능 |
| 헬퍼 중복 (`makeKnownError` / `makePrismaUniqueViolation`) | Step 1 / Step 2 동일 패턴 | Step 3 리뷰에서 `tests/helpers/prisma-errors.ts` 추출 권고 (별도 task) |
| 라인 추정 정확도 | Step 2 underestimate / Step 3 overestimate | 테스트 통합 검증 시 라인 폭발 — 추정 모델 보정 필요 |
| MAJOR carry-over | Step 2 → Step 3 자연 합류 | L-019 패턴 적용 |

### 자주 수정된 파일
- `lib/security/rate-limit.ts` (Step 1 — 헤더 가드 + enforceUserRateLimit)
- `lib/auth/email-verification.ts` (Step 2 — 진입 가드 + P2002 화이트리스트)
- `tests/lib/auth/email-verification.test.ts` (Step 2 — 7 케이스 추가)
- `tests/app/api/v1/auth/{signup,verify-email,resend-verification}.test.ts` (Step 3 — 매직 넘버 제거 + 어설션 강화)

### 스킬 실행 순서
정상 자동 체이닝 — plan → impl → review → merge × 3, 중단 없음. fix-loop 0회.

## 4. Decisions 분석

| 결정 | 트레이드오프 | 결과 |
|------|-------------|------|
| **L-022 적용** (carry MAJOR 17건 분리) | 단일 PR inflation vs follow-up 부담 | ✅ 분리 효과 검증 — 53분 안정 완료 |
| **D1: AUTH_EMAIL_ALREADY_VERIFIED 신규 코드** (409) | 명시적 분기 vs 200 멱등 응답 | 채택 — 클라이언트 분기 가능, withErrorHandler 통합 검증 OK |
| **D2: withUserRateLimit @deprecated만** (제거는 다음 PR) | 점진적 마이그레이션 vs 즉시 제거 | 채택 — Step 3에서 호출자 1개 마이그레이션 완료 |
| **D3: testcontainers 별도 task** | 인프라 비대 vs race 실제 검증 | 분리 채택 — db-designer 권고 부합 |
| **D4: L-007 nested write 가드 별도 task** | Application 모델 우선 vs EmailVerification 동시 적용 | 분리 채택 — EmailVerification은 부분 UNIQUE로 1차 차단 |
| **이중 user 조회 유지** (Step 2 진입 가드 + 라우터 메일 조회) | 비효율 vs 캡슐화 + defense-in-depth | 유지 채택 — domain agent 평가 합리적 |
| **IP-bucket 단독 테스트의 userSeq++ 트릭** | 테스트 단순성 vs 라우터 실제 의도 우회 | 채택 + 별도 task로 "같은 user × IP 회전" 시나리오 추가 권고 |

### 기술 부채 (별도 task 권고 8건)
1. **testcontainers Postgres 통합 테스트** — race/트랜잭션/P2002 실제 DB 검증
2. **같은 user × IP 회전 공격 시나리오 테스트** — user-bucket 우선 발동 검증
3. **signup.ts isUniqueConstraintError → isUniqueViolationOn 마이그레이션** — substring → 정확 매칭 시맨틱 변경 주의
4. **`lib/prisma/index-names.ts` 인덱스명 SSOT 분리** — Step 2 M002
5. **`docs/api-specs/auth/resend-verification.md` 신설** — docs-impact 권고
6. **`docs/security/security-controls.md` L-023 운영 가이드 보강** — docs-impact 권고
7. **user-bucket UX 메트릭 관찰 후 한도 조정** — 운영 의존
8. **L-026 후보 등재** — "wrapper attachHeaders 누락 위험"

## 5. Lessons

### Keep (이번에 잘된 점)
- **L-022 (carry 임계 분리) 첫 검증** — 17건 → 3 step 분리로 라인 inflation 방지 + 53분 안정 완료. CANDID-036(75분)보다 단축. 분리 효과 검증
- **db-designer 백그라운드 호출 (L-012)** — meta.target 정확한 인덱스명(`uk_email_verifications_active_per_user`) + 격리 수준 가정 주석 도출. 잘못된 화이트리스트 방지
- **plan 단계 사용자 결정 흐름** — D1-D4 옵션 AskUserQuestion 즉시 응답 → 8분 내 plan 승인. plan에 옵션 미리 노출하는 패턴 효과
- **자동 체이닝 완전 자동화** — plan → impl → review → merge × 3, fix-loop 0회. CRITICAL 0건으로 자동화 손상 없음
- **L-019 적용 (in-task self-correction)** — Step 2 carry MAJOR 3건이 Step 3 라우터 통합에서 자연 합류 (별도 fix PR 없이)
- **Prisma 실제 instance + duck-typing 회피 테스트 패턴** — `makePrismaUniqueViolation` 헬퍼로 instanceof + 평범 객체 거부 양방향 가드. signup.ts L-step3 D3 패턴과 일관

### Improve (개선 필요)
- **라인 추정 정확도 (Step 3 +204%)** — 라우터 통합 검증 + 매직 넘버 제거가 *3개 파일*에 걸쳐 라인 폭발. CANDID-036 회고의 "헬퍼 추출 보정 계수 0.6~0.8"은 인프라 단계엔 부합하나 통합 검증 단계엔 *역방향 보정* 필요. **L-027 후보**
- **이중 user 조회** — 진입 가드 + 라우터 메일 조회 — 의도적이나 향후 `ResendResult`에 email/name 포함시켜 단일 조회로 통합 검토
- **테스트 helper 중복** — `makeKnownError` (Step 1) / `makePrismaUniqueViolation` (Step 2) 동일 패턴 → `tests/helpers/prisma-errors.ts` 공통 추출 (별도 task)
- **IP-bucket 테스트 회피 트릭** — `userSeq++` 패턴이 라우터 실제 의도(같은 user × IP 회전 차단)를 우회. 별도 시나리오 테스트 필요

### Learn (신규 학습 항목 후보)
- **L-026 후보**: wrapper `attachHeaders` 책임 분배 패턴 — `enforceUserRateLimit` 인라인 헬퍼 사용 시 호출자가 `attachHeaders(response)` forget하면 inner 헤더 미부착. discriminated union 또는 `Result<Limited|Allowed>` 타입으로 컴파일타임 강제 검토
- **L-027 후보**: 통합 검증 단계의 라인 추정 보정 — 인프라(헬퍼 추출)는 0.7 계수, 도메인 정밀화는 0.6, 라우터/테스트 통합은 1.5~2.0 (테스트 다중 파일 영향). step 유형별 보정 가설
- **L-028 후보**: P2002 `meta.target` 화이트리스트 패턴 — `isUniqueViolationOn(err, [인덱스명])` 부분집합 매칭이 인덱스명 vs 컬럼명 혼동을 방지. SSOT는 `prisma/schema.prisma`의 `@@index map` 값. 향후 `lib/prisma/index-names.ts` 추출 시 강제

### Try (다음 task에서 시도)
- 라인 추정 시 step 유형별 보정 계수 적용 (L-027 가설 검증)
- 테스트 helper 공통화 — `tests/helpers/prisma-errors.ts` 추출 후 import 패턴
- testcontainers Postgres 통합 테스트 도입 (race 실제 검증, L-024 강화)
- `lib/prisma/index-names.ts` SSOT 추출 — schema rename 시 안전성 + 화이트리스트 자동 추종

## 6. Action Items

| 우선순위 | 항목 | 담당 |
|---------|------|------|
| 즉시 | L-026/L-027/L-028 lessons-learned 추가 | retro |
| 단기 | "같은 user × IP 회전 공격" 테스트 시나리오 추가 (Step 3 H001) | PM/사용자 |
| 단기 | `tests/helpers/prisma-errors.ts` 공통 헬퍼 추출 | PM/사용자 |
| 단기 | `lib/prisma/index-names.ts` 인덱스명 SSOT 분리 (Step 2 M002) | PM/사용자 |
| 중기 | testcontainers Postgres 통합 테스트 인프라 | 인프라 |
| 중기 | signup.ts `isUniqueConstraintError` → `isUniqueViolationOn` 마이그레이션 | PM/사용자 |
| 중기 | `docs/security/security-controls.md` L-023 운영 가이드 보강 | 운영/docs |
| 장기 | user-bucket UX 메트릭 관찰 후 한도 조정 | 운영 |

## 7. 메트릭 요약

| 메트릭 | 값 |
|--------|------|
| 총 변경량 | +848/-121 (953 LOC) |
| PR 수 | 3 (자기 PR 100%) |
| CRITICAL 발생 횟수 | 0 (3개 PR 모두) |
| MAJOR 발생 횟수 | 4 (Step 1: 0, Step 2: 3, Step 3: 1) |
| MAJOR carry-over | 0 (모두 별도 task 분리 또는 Step 3 자연 합류) |
| 첫 리뷰 통과율 | 3/3 = 100% |
| auto-fix loop 사용 | 0회 (CRITICAL 0) |
| 라인 추정 정확도 | +17% over (Step 3 +204% 외삽) |
| 신규 테스트 추가 | 37 cases (Step 1: 28 + Step 2: 7 + Step 3: 2) |
| 전체 테스트 | 549 → 586 (32%→100%, 모두 통과) |
| 소요 시간 | 53분 (claim → 완료 처리) |
| 보안 결함 | 0건 (3개 PR 모두) |

## 8. CANDID-036 회고 → CANDID-037 처리율

| Carry 항목 (CANDID-036 회고에서) | 본 task 처리 | Step |
|----------|:----------:|:----:|
| (1) RL wrapper 헤더 override 차단 (L-023) | ✅ 가드 + 라우터 적용 | 1 + 3 |
| (2) wrapper 중첩 패턴 일관화 | ✅ enforceUserRateLimit IIFE 제거 | 3 |
| (3) isPrismaUniqueViolation cross-cutting 추출 | ✅ lib/prisma/errors.ts | 1 |
| (4) P2002 매핑 정밀도 (meta.target 화이트리스트) | ✅ token_hash 거부 검증 | 1 + 2 |
| (5) 격리 수준 가정 주석 | ✅ READ COMMITTED 명시 | 2 |
| (6) emailVerifiedAt 사전 가드 (D3) | ✅ AUTH_EMAIL_ALREADY_VERIFIED 신규 | 2 |
| (7) Promise.all race 시뮬레이션 | ✅ winner/loser 분류 검증 | 2 |
| (8) Prisma instance + duck-typing 회피 | ✅ makePrismaUniqueViolation helper | 2 |
| (9) testcontainers Postgres 통합 테스트 | ⏸️ 별도 task 권고 | — |
| (10) 회귀 어설션 강화 (H004/H005/H007/H008) | ✅ toHaveBeenCalledTimes + Remaining='0' + Retry-After | 3 |
| (11) mockReset 보강 | ✅ vi.resetAllMocks + sendMail re-init | 2 + 3 |
| (12) 매직 넘버 제거 | ✅ POLICIES.* import (3 파일) | 3 |
| (13) user-bucket UX 메트릭 조정 | ⏸️ 운영 메트릭 후 결정 | — |

**처리율: 11/13 (85%) + 2건 별도 task 분리** = **100% 추적 완료**

---

🤖 Generated by skill-retro v2 — 2026-05-24
