# CANDID-010 회고 — 이메일 회원가입 API + 인증 메일 발송

## 기본 정보

| 항목 | 값 |
|------|------|
| Task ID | CANDID-010 |
| 제목 | 이메일 회원가입 API + 이메일 인증 메일 발송 |
| Phase | 2 (핵심 도메인) · Priority high |
| 시작일 (claim) | 2026-05-23 (5442f67) |
| 완료일 (Step 3 머지) | 2026-05-23T12:51:22Z (8f6adfa) |
| 총 머지 소요 (Step 1 → Step 3) | 약 47분 (12:03 → 12:51) |
| 스텝 수 | 3 (DB+인프라 / 가입 API / 토큰 검증·재발송) |
| PR 수 | 3 (#31, #32, #33) — 자기 PR 전부 |
| PRD 근거 | docs/sample-requirement.md §US-AUTH-001, §4.2.6 BR-AUTH-01/02/04, §4.2.7 BR-SEC-04, §4.2.5 BR-PII-05 |

## 변경 규모

| Step | PR | 변경량 | 예상 라인 | 실제/예상 |
|:----:|:---:|------:|---------:|:--------:|
| 1 | #31 | +854/-9 | 500 | +71% |
| 2 | #32 | +566/-10 | 550 | +3% |
| 3 | #33 | +694/-33 | 450 | +54% |
| **총합** | — | **+2,114/-52** | 1,500 | +41% |

> Step 1·3에서 carry-over fix + 신규 시나리오 추가로 라인 inflation 발생. Step 2만 추정 정확.

## 1. Speed 분석

- **plan → 첫 PR 머지**: claim(5442f67) → plan approved(e29d101) → Step 1 PR #31 머지(12:03Z) — 동일 일자 진행
- **PR 간격**: Step 1 머지 → Step 2 머지 13분, Step 2 → Step 3 머지 34분 — Step 3가 carry-over 처리 + 신규 코드로 2배 이상 소요
- **자기 PR 전부** → 리뷰 대기 시간 0 (셀프 COMMENT 처리)
- **병목**: Step 3 — Step 2의 MAJOR 9건 carry-over + 신규 14건이 동일 PR에 누적됨

## 2. Quality 분석

| 지표 | Step 1 | Step 2 | Step 3 |
|------|:------:|:------:|:------:|
| CRITICAL 발견 | **1** (C001 transport.test.ts:71-72) | 0 | 0 |
| auto-fix 루프 | 1/2 사용 | — | — |
| MAJOR (해당 PR 내 처리) | 6건 (fix loop bundle) | 0 | 5건 (Step 2 carry 처리) |
| MAJOR carry-out | 2건 → Step 2 | 9건 → Step 3 | **14건 → 다음 task** |
| 첫 리뷰 통과 | ❌ (fix 후 통과) | ✅ | ✅ |

### 핵심 관찰
- **CRITICAL은 Step 1에서만 1회 발생** → skill-fix loop으로 동일 PR 내 즉시 해소. L-009 패턴 효과적.
- **MAJOR carry-over가 누적 증가**: 2 → 9 → **14건**. step이 진행될수록 다음 단계 부담이 가중되는 누적 패턴 발견.
- Step 3 MAJOR 14건은 다음 task로 carry되어, CANDID-010 종료 시점에 **기술 부채로 남음**.

## 3. Patterns 분석

### 반복된 이슈 유형 (Step 1 ~ Step 3 누적)
| 유형 | 발생 step | 비고 |
|------|----------|------|
| 트랜잭션 경계 회귀 가드 부재 | Step 3 H010/H011 | 계획서 명시 시나리오 미반영 |
| 표준 에러 응답 7필드 회귀 가드 비대칭 | Step 2 Test MAJOR, Step 3 H014 | signup만 강화, verify-email/resend는 약함 |
| Rate Limit 정밀도 (IP-only) | Step 1 SMTP, Step 3 H004/H005 | userId-bucket 필요성 반복 |
| 평문 PII 로깅 | Step 3 H003 | CLAUDE.md 위반 — 회귀로 발생 |

### 자주 수정된 파일
1. `lib/auth/signup.ts` (Step 2 신규 → Step 3 D3 carry fix)
2. `tests/lib/auth/signup.test.ts` (Step 2 신규 → Step 3 Test MAJOR 5건 carry fix)
3. `app/api/v1/auth/signup/route.ts` (Step 2 → Step 3 미세 조정)

### 스킬 실행 순서
정상 자동 체이닝 (plan → impl → review → merge × 3) — 중단 없음.
다만 Step 1에서 1회 auto-fix loop 발동, Step 2·3은 자기 PR이라 COMMENT 처리.

## 4. Decisions 분석

| 결정 | 트레이드오프 | 결과 |
|------|-------------|------|
| **bcryptjs (pure JS) vs bcrypt (native)** | 속도↓ vs 컴파일 부담↓ | Node 20 strength 12 ~250ms 수용 — OK |
| **BR-PII-05 옵션 C** (자기 확인 + 지원서 시점 정밀 검증) | 가입 단계 마찰↓ vs 정밀 검증 지연 | 채택, ageConfirmed literal(true) zod로 강제 |
| **email_verification 평문 token → sha256 hex** | DB 유출 시 계정 탈취 차단 | db-designer 권고 채택, L-006 패턴 일관 |
| **메일 발송 fire-and-forget** | UX 우선 vs 발송 실패 추적성↓ | BR-TX-02 명시적 준수, 단 회귀 가드(H012) 누락 |
| **자동 로그인 (가입=로그인 일체)** | 사용자 마찰↓ vs 미인증 상태 노출 | 응답에 `emailVerifiedAt: null` 명시로 클라이언트 UI 분기 가능 |

### 기술 부채 (다음 task로 carry)
- **H001/H009**: `consumeVerificationToken` FOR UPDATE 부재 → 동시 클릭 race window
- **H003**: signup 라우터 평문 이메일 로깅 (PII 노출 — 즉시 fix 가능)
- **H004/H005**: Rate Limit 정밀화 (userId-bucket + verify-email 정책)
- **H006**: 메일 링크 평문 토큰이 GET query에 노출 (mail security scanner pre-click 운영 이슈)
- **H007**: 이메일 인증 변경 audit log 누락 (CANDID-026 연계)
- **H008**: 만료/소진 토큰 cleanup cron 부재 (BR-PII-03 자동 파기와 불일치)
- **H010~H014**: 테스트 가드 (트랜잭션 롤백, 동시성, BR-TX-02, 표준 7필드, user null 분기)

## 5. Lessons

### Keep (이번에 잘된 점)
- **Plan 단계 db-designer 백그라운드 호출** (L-012) — 본 task에서 4건 권고 (동의 컬럼 4종, sha256 토큰, 부분 인덱스, 트랜잭션 경계) 모두 plan에 반영. 메인 컨텍스트 토큰 절약.
- **In-task self-correction** (L-019) — Step 1 MAJOR 2건 → Step 2 자연 합류, Step 2 MAJOR 9건 → Step 3 carry-over 처리. L-009 fix loop과 L-019 next-step bundle을 상황별로 활용.
- **3-layer defense-in-depth** (L-006) — 비밀번호 hash + zod 검증 + Prisma layer. sha256 토큰-해시 패턴이 일관 적용됨.
- **BR-TX-02 fire-and-forget 명시화** — 메일 발송이 가입 트랜잭션을 막지 않음. 주석으로 의도 노출.
- **자기 PR 전부 + COMMENT 처리** — GitHub 승인 불가 정책에 자연 대응.

### Improve (개선 필요)
- **라인 추정 정확도** — Step 1 +71%, Step 3 +54% 초과. carry-over로 인한 inflation을 추정에 반영 못함. L-010을 보강할 carry-over 계수 필요.
- **MAJOR carry-over 누적 임계** — 2 → 9 → 14건 증가. 일정 수치 초과 시 다음 step 번들이 아닌 별도 fix PR로 분리하여 누적 부담 차단 필요. L-019/L-009의 사용 분기 정밀화.
- **회귀 가드 비대칭** — signup.test.ts는 7필드/평문 토큰 노출 가드 강한 반면, verify-email/resend는 약함. 같은 PR에서 동일 패턴 라우터들끼리 가드 일관성을 reviewer 체크리스트로 끌어올릴 필요.
- **state 파일 SSOT 무결성** — 회고 시점 `.claude/state/project.json` / `backlog.json` 부재 발견. git pull로 동기화되는 SSOT가 손실되면 워크플로우 자동화 전반 마비.
- **CI 미설정** — `gh pr checks 33`이 "no checks reported" 응답. 빌드/테스트/린트가 수동 의존. 자동 검증 도입 필요.

### Learn (신규 학습 항목)
- **L-022 후보**: MAJOR carry-over 누적 임계 — 단일 PR로 carry-over되는 MAJOR가 한계(예: ≥7건) 초과 시 다음 step 번들이 아닌 **별도 fix PR**로 분리. 본 task에서 9→14건 증가가 운영 부담을 가시화.

### Try (다음 task에서 시도)
- step 라인 추정에 **carry-over inflation 계수 1.3~1.5** 곱하기 (특히 마지막 step)
- MAJOR carry 7건+ 임계 도달 시 별도 fix PR 분리
- 동일 PR 내 유사 라우터(e.g. signup·verify-email·resend) 테스트 가드 **대칭 검사** reviewer 체크리스트에 추가

## 6. Action Items

| 우선순위 | 항목 | 담당 |
|---------|------|------|
| 즉시 | H003 PII 로깅 fix (signup 라우터) — 1줄 마스킹 변경 | 별도 hotfix 또는 다음 task 첫 commit |
| 단기 | state 파일 복원 (project.json / backlog.json) — git 과거 commit 추적 | 사용자 |
| 단기 | H001/H009/H004/H005/H010~H014 묶음 — 신규 task로 등록 권장 | PM/사용자 |
| 중기 | H006 메일 링크 패턴 재설계 / H008 cleanup cron — 횡단 task | 사용자 |
| 중기 | CI 빌드/테스트/린트 자동 검증 도입 | 인프라 |
| 학습 | L-022 추가 (MAJOR carry 임계) — `.claude/state/lessons-learned.json` | retro |

## 7. 메트릭 요약

| 메트릭 | 값 |
|--------|------|
| 총 변경량 | +2,114 / -52 |
| PR 수 | 3 (자기 PR 100%) |
| CRITICAL 발생 횟수 | 1 (Step 1) — auto-fix loop 1/2로 해소 |
| MAJOR carry-out (task 종료 시점) | 14건 (Step 3 → 다음 task) |
| 첫 리뷰 통과율 | 2/3 = 67% (Step 2·3 통과, Step 1 fix loop) |
| 라인 추정 정확도 | 평균 +41% over-run (carry-over inflation) |
| auto-fix loop 사용 | 1회 (Step 1) — 임계 2회 미달 |

---

🤖 Generated by skill-retro v2 — 2026-05-23
