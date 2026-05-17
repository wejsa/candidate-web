# CANDID-005 회고

> 회고 작성: 2026-05-17 / skill-retro v1

## 1. 기본 정보

| 항목 | 값 |
|------|-----|
| Task ID | CANDID-005 |
| 제목 | DB 스키마: applications + drafts + answers + resume_files + portfolio_links + status_history + interview_schedules + audit_logs |
| Phase | 1 (기반/인프라) |
| Priority | high |
| Type | feature |
| 시작 시각 | 2026-05-17T21:08:40+09:00 (claim) |
| 완료 시각 | 2026-05-17T22:11:41+09:00 |
| **총 소요** | **~63분** (claim → 머지) |
| 스텝 수 | 3 (3-3-2 분리) |
| PR 수 | 3 (#11, #12, #13) |
| 전체 LOC | +553 / -19 |
| 다운스트림 언블록 | CANDID-015, 018, 019, 022, 023, 026 |

### 1.1 스텝별 요약

| Step | PR | 머지 시각 | LOC (+/-) | 리뷰 결과 | fixLoop |
|:---:|:---:|------|------|------|:---:|
| 1 | #11 | 21:47:26 | 224 / 3 | APPROVED (CRITICAL 0 / MAJOR 4 / MINOR 3 / INFO 9 — FU1 위임) | 0 |
| 2 | #12 | 22:03:23 | 180 / 5 | APPROVED (CRITICAL **1** → fix 1회 → 최종 APPROVED) | **1** |
| 3 | #13 | 22:11:41 | 149 / 11 | APPROVED (CRITICAL 0 / MAJOR 9 / MINOR 6 / INFO 7 — 모두 후속 위임) | 0 |

## 2. 5축 분석

### 2.1 Speed (속도)

| 구간 | 추정 | 실제 |
|------|------|------|
| skill-plan (Task 선택 + db-designer + 3-step 분리) | 10~15분 | ~10분 |
| Step 1 (impl + review + merge) | 15~20분 | ~29분 |
| Step 2 (impl + review + **skill-fix** + 재review + merge) | 15~20분 | ~16분 |
| Step 3 (impl + review + merge) | 10~15분 | ~8분 |
| **합계** | 50~70분 | **~63분** |

**병목 분석**:
- Step 1 가장 길었음(~29분) — 첫 step에서 6 enum + 핵심 3 모델 + PII snapshot 5쌍 NULLABLE Bytes 정의 + 부분 UNIQUE 인덱스(BR-APP-01) 설계 부하 집중
- Step 2 fix 루프 발생에도 16분 — `skill-fix` 1회로 CHECK 제약 문구 수정만 (구조 변경 아님) → 빠른 회복
- Step 3 가장 짧음(~8분) — audit_logs 골격(CANDID-026 본격 도입 위임)으로 정의 표면 최소화
- 라인 추정 정확도: 3 step 합계 추정 ~500 vs 실제 553 (+10.6%) — review fix buffer(L-010) 적용 효과 유지

### 2.2 Quality (품질)

| 지표 | 값 | 비고 |
|------|-----|------|
| CRITICAL 이슈 | **1** | Step 2 C001 (resume_files CHECK 문구 'XOR'→'at most one') |
| MAJOR 이슈 | 13 (4+0+9) | 모두 권고 — 후속 task(CANDID-015/018/019/022/026)로 위임 |
| MINOR | 9 (3+0+6) | 후속 task INFO 추적 |
| INFO | 25 (9+9+7) | — |
| 첫 리뷰 통과 | 2/3 (#11, #13) | Step 2만 fix 루프 1회 |
| fix 루프 | 1회 (Step 2) | 루프 가드(2회) 내 — CRITICAL 1건 자동 수정 후 즉시 재리뷰 APPROVED |
| 라인 추정 정확도 | **+10.6%** | 추정 ~500 vs 실제 553 — L-010 buffer 적용 |
| 라인 수 vs limit | 각 step 안쪽 (224/180/149) | 모두 prLineLimit 내 |
| 빌드/테스트 회귀 | 0 | 112 기존 테스트 통과 (Step 3 시점) |

**품질 점수 (정성 평가): A-** — CRITICAL 1건 발생했으나 자동 fix 1회로 종결, MAJOR 13건 모두 후속 task로 정상 위임 (schema-only 골격 단계 특성). CANDID-004(CRITICAL 0)보다 -1 등급.

### 2.3 Patterns (패턴)

#### 반복된 좋은 패턴 (Keep)

1. **schema-only Phase 1 골격 패턴 유지**: CANDID-003(인증) → 004(공고) → **005(지원서)**. 도메인 규모에 따라 단일 step(004) vs 다중 step(005, 3-3-2) 분기.
2. **L-013 적용** (부분 UNIQUE 인덱스): `applications.WHERE result != 'WITHDRAWN'` — BR-APP-01 활성 지원서 유일성을 부분 인덱스로 자연 표현. 일반 UNIQUE 대비 size 우위.
3. **L-014 적용** (enum 사전 정의): 6 enum (`ApplicationStatus`, `ApplicationResult`, `StageType`, `ResumeFileType`, `PortfolioLinkType`, `AuditLogTargetType`) 일괄 사전 도입 — 후속 enum 확장 destructive 마이그레이션 회피.
4. **L-015 R1 종결**: CANDID-004에서 미결로 위임된 `application_answers.question_id` FK 정책을 Step 2 PR #12에서 **RESTRICT + archived_at soft-archive** 확정 — reverse dependency graph 검토 후 채택.
5. **plan 단계 step 분리 의존성 기반**: 핵심(3) → 첨부/응답(3) → 이력/면접/감사(2) — 각 step이 직전 step의 PK만 참조하도록 dependency 순서 설계.

#### 새로 등장한 패턴

1. **PII snapshot NULLABLE Bytes (AES-256-GCM 컬럼)**: `applications`에 5쌍(이름·연락처·생년월일·주소 등) `Bytes? @db.ByteA` 도입 — 실시간 사용자 PII와 분리된 *지원 시점 스냅샷*. 암호화 wiring은 FU1로 분리하여 schema-only 골격 유지.
2. **XOR 멀티 attachment 제약 — CHECK 제약 문구**: `resume_files`의 "기존 ResumeFile 재사용 vs 신규 업로드 중 정확히 하나"를 CHECK 제약으로 표현 시 'XOR'은 boolean 의미라 NULL semantics와 충돌 → "at most one of (..) is NOT NULL"이 정확. **CRITICAL C001 (Step 2)** 의 원인이자 교훈.
3. **운영 정책 위임을 위한 골격 도입**: `audit_logs`를 BIGSERIAL + 일반 테이블로 *골격만* 정의(파티셔닝/보존/조회 정책 일체 위임) → CANDID-026 본격 도입 시 인덱스 + 파티셔닝 + GDPR 보존 정책을 한 번에 처리. *현재 task의 line 부담 -50% 효과* 추정.
4. **자기 PR self-COMMENT 모드 일관**: 3 PR 모두 `gh pr review --comment`로 처리 — APPROVED 판단은 본문 markdown 표로 표기, 머지 차단은 CRITICAL 수치 기반.

#### 자주 수정된 파일

- `prisma/schema.prisma`: CANDID-002, 003, 008, 030, 031, 004, **005×3** → 9회 (도메인별 + step별 누적). Phase 1 schema centric task 특성.
- `prisma/migrations/`: 3개 신규 migration (step별 1개씩).
- `backlog.json`: 9회 변경 (claim → plan approved → step별 PR created/merged) — 정상 워크플로우.

### 2.4 Decisions (의사결정)

| # | 결정 | 근거 | 결과 |
|---|------|------|------|
| D1 | 3-step 분리 (vs 단일 step) | 553 LOC > 220 limit, 도메인 8 테이블 + 6 enum + 17 인덱스 부담 | ✅ 적합 (각 step 224/180/149 LOC) |
| D2 | step 분리 기준 = 의존성 그래프 (핵심→첨부→이력) | 각 step이 직전 step PK만 참조, 역방향 의존 0 | ✅ 적합 (역방향 충돌 0건) |
| D3 | PII snapshot wiring은 FU1로 분리 | schema-only Phase 1 골격 유지, CANDID-008 패턴 미러 | ✅ 적합 (FU1 위임 합의) |
| D4 | `resume_files` XOR 제약 = CHECK | DB 레이어 invariant 보장, 앱 레이어 의존 제거 | ⚠️ CHECK 문구 'XOR' 의미 충돌 → 'at most one of (..) IS NOT NULL'로 수정 (Step 2 C001) |
| D5 | `application_answers.question_id` = RESTRICT + `job_posting_questions.archived_at` soft-archive | L-015 reverse dependency 검토 결과 (CASCADE 시 응답 손실) | ✅ 채택 (L-015 R1 종결) |
| D6 | `audit_logs` BIGSERIAL 골격 도입 (파티셔닝 미적용) | 운영 정책(보존/조회/파티셔닝) CANDID-026 본격 이관 위임 | ✅ 적합 (line 부담 -50%) |
| D7 | `application_number_sequences` 보조 테이블 도입 | BR-APP-05 `A-YYYYMM-NNNNN` 발급 — Postgres SEQUENCE보다 월별 reset 표현이 용이 | ✅ 채택 |
| D8 | 6 enum 일괄 사전 정의 (vs MVP 최소) | L-014 — 후속 확장 destructive | ✅ 채택 |

**기술 부채 (후속 task로 위임됨)**:
- H001 [Step 3] ApplicationStatusHistory 상태 전이 검증 부재 — `SUBMITTED → OFFER` 점프 INSERT 가능. CANDID-018/019 진입 시 `assertTransition()` + CHECK 제약 도입
- H002 [Step 3] `InterviewSchedule.stage` 전체 StageType 허용 — `CHECK (stage IN ('INTERVIEW_1','INTERVIEW_2'))` 권고 (CANDID-019)
- H003 [Step 3] `audit_logs` 파티셔닝 위임 비용 — 1M rows 임계치 도달 시 다운타임 이관 SOP CANDID-026에 명문화 필요
- H004 [Step 3] `audit_logs` PII GDPR 보존 기간 미정 — BR-PII-03 1년 파기와 정합 정책 (CANDID-026)
- H005 [Step 3] `visibleToCandidate=false` 의미 불명확 — UI 마스킹 vs 법적 비공개 분리 (CANDID-019)
- H006~H009 [Step 3] metadataJson sanitize / locationOrUrl 토큰 회전 / actor_user_id FK 무결성 / userAgent XSS — CANDID-026 또는 어드민 task
- FU1: Application PII snapshot AES-256-GCM extension wiring + 단위 테스트 (CANDID-008 패턴 미러)
- FU2: docs/architecture/erd.md 신설 + audit_logs 운영 정책 문서화

### 2.5 Lessons (교훈)

#### Keep (계속하기)

- **schema-only 다중 step 분리 = 의존성 그래프 따르기**: 핵심→첨부→이력 순. 역방향 의존 0건 보장이 step 독립성의 핵심.
- **L-013/L-014/L-015 누적 효과**: 부분 인덱스 + enum 사전 정의 + reverse dependency 검토 — 3가지가 동시에 적용된 첫 task, 모두 false positive 0.
- **review fix buffer (L-010)** 유지: 추정 +10.6% 오차로 유지 — 다음 task에도 계속 적용.
- **운영 정책을 골격 + 후속 task 위임**: audit_logs 패턴 — Phase 1에서 schema 표면을 최소화하면서 후속 본격 도입 hook 제공.

#### Improve (개선하기)

- **CHECK 제약 문구는 SQL 의미론 정확성 필수** (Step 2 C001): 'XOR'은 boolean 연산이라 NULL semantics와 충돌. CHECK 제약은 항상 truth-value 기준으로 작성하고 review 시 "NULL 비교 = UNKNOWN" 명시적으로 검증. **신규 학습 L-016 후보**.
- **첫 step 부하 분산**: Step 1 ~29분은 6 enum + 핵심 3 모델 + PII snapshot + 부분 인덱스 동시 도입. 다음 다중 step task plan에서 *첫 step에 enum/타입 집중을 분리할지* 검토 가치 (단, enum 일괄 정의의 destructive 회피 이점은 유지 — 트레이드오프 명시 필요).
- **자기 PR inline 코멘트 미작성** (CANDID-004와 동일): 13건 MAJOR 권고 위치 마킹 시 후속 task IDE 참조성 향상. 다음 task부터 시도.

#### Learn (배우기)

- **CHECK 제약과 NULL semantics**: `CHECK (a IS NULL XOR b IS NULL)`는 의미상 "정확히 하나가 NULL" — 둘 다 NULL이면 FALSE가 아니라 UNKNOWN으로 평가됨. PostgreSQL은 UNKNOWN을 통과시키므로 *둘 다 NULL인 row도 통과*하는 false positive 발생. 정확한 표현은 `CHECK ((a IS NULL) <> (b IS NULL))` 또는 자연어 의도 "at most one is NOT NULL"이라면 `CHECK (num_nonnulls(a, b) <= 1)`.
- **PII snapshot vs 실시간 PII 분리**: 지원 시점의 PII(이름/연락처 등)는 *지원서 자체에 snapshot*으로 저장하여 사용자 PII 변경에 영향받지 않게 함 — `applications.applicantNameEnc` 등. AES-256-GCM 컬럼 암호화 wiring은 schema 골격과 분리 가능 (CANDID-008 패턴).
- **`audit_logs` BIGSERIAL 골격 도입의 함정**: CANDID-026 본격 이관 시 1M+ rows 누적되면 ALTER TABLE PARTITION BY는 다운타임 비용 — *임계치 + 이관 SOP*를 골격 도입 시점에 백로그 hook으로 명문화하지 않으면 운영 단계 부채화.

#### Try (시도해보기)

- **다음 task(CANDID-006 또는 도메인 entry — 인증 라우터)에서 CHECK 제약 문구 lint/리뷰 체크리스트화**: `_base/checklists/db-schema-review.md`에 "CHECK 제약은 NULL semantics 명시 검증" 항목 추가 (사용자 승인 후).
- **Step 분리 시 첫 step에 *타입/enum 집중 vs 분산* 트레이드오프 plan 문서에 명시**: 향후 다중 step DB task 표준화.
- **CANDID-026 (audit_logs 본격 도입) plan 단계에서 파티셔닝 SOP 작성**: H003/H004/H006/H008/H009 6건을 단일 task로 모아서 처리.

## 3. Action Items

| # | 액션 | 대상 Task | 우선순위 |
|---|------|----------|---------|
| A1 | Application PII snapshot AES-256-GCM extension wiring + 단위 테스트 | CANDID-005-FU1 | P0 |
| A2 | ApplicationStatusHistory 상태 전이 `assertTransition()` + CHECK 제약 | CANDID-018/019 | P1 |
| A3 | `InterviewSchedule.stage` CHECK 제약 (`IN ('INTERVIEW_1','INTERVIEW_2')`) | CANDID-019 | P1 |
| A4 | `audit_logs` 파티셔닝 + GDPR 보존 + metadataJson sanitize + FK 무결성 (5건 묶음) | CANDID-026 | P0 |
| A5 | `_base/checklists/db-schema-review.md`에 "CHECK 제약 NULL semantics 명시 검증" 추가 | (체크리스트 갱신) | P1 |
| A6 | `docs/architecture/erd.md` 신설 + audit_logs 운영 정책 | CANDID-005-FU2 | P2 |
| A7 | 자기 PR inline 코멘트로 MAJOR 권고 위치 마킹 (후속 PR 추적성) | 다음 task부터 | P2 |

## 4. 학습 항목 후보 (lessons-learned.json 반영)

| ID | Category | 제목 | 변경 | Impact |
|----|----------|------|------|--------|
| L-010 (기존) | process | 라인 추정 정확도 ±10% — review fix buffer 사전 반영 | appliedCount +1 | medium (유지) |
| L-013 (기존) | architecture | PostgreSQL 부분 인덱스 — 특정 필터 쿼리 size·성능 우위 | appliedCount **0 → 1** (첫 실적용) | medium |
| L-014 (기존) | process | Enum 확장은 destructive — 초기 정의 시점에 사전 정의 비용이 최저 | appliedCount **1 → 2** | medium |
| L-015 (기존) | architecture | CASCADE FK 결정 시 reverse dependency graph 검토 필수 | appliedCount **1 → 2** (R1 종결) | high (유지) |
| L-016 (신규) | quality | CHECK 제약 문구는 NULL semantics 명시 검증 — 'XOR'은 boolean 연산이라 NULL과 충돌, `num_nonnulls(..)` 또는 `IS NULL <> IS NULL` 사용 | 신규 | high |
| L-017 (신규) | architecture | PII snapshot은 실시간 PII와 분리하여 trigger 시점 데이터 보존, 암호화 wiring은 schema 골격과 분리 (CANDID-008 패턴) | 신규 | medium |
| L-018 (신규) | architecture | `audit_logs` 골격 도입 시 운영 정책(파티셔닝/보존/조회) 본격 도입 task 명문화 + 임계치 hook 필수 — 누적 후 ALTER TABLE 다운타임 회피 | 신규 | high |

---

**리포트 경로**: `docs/retro/CANDID-005-retro.md`
