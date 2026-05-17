# CANDID-004 회고

> 회고 작성: 2026-05-16 / skill-retro v1

## 1. 기본 정보

| 항목 | 값 |
|------|-----|
| Task ID | CANDID-004 |
| 제목 | DB 스키마: job_postings + job_categories + job_posting_questions |
| Phase | 1 (기반/인프라) |
| Priority | high |
| Type | feature |
| 시작 시각 | 2026-05-16T15:30:10+09:00 (UTC 06:30:10Z) |
| 완료 시각 | 2026-05-16T15:47:48+09:00 (UTC 06:47:48Z) |
| **총 소요** | **~18분** (lock → 머지) |
| 스텝 수 | 1 (단일 PR) |
| PR 수 | 1 (#10) |
| 다운스트림 언블록 | CANDID-005, 013, 014, 015 |

## 2. 5축 분석

### 2.1 Speed (속도)

| 구간 | 추정 | 실제 |
|------|------|------|
| skill-plan (Task 선택 + db-designer + 계획) | 5~10분 | ~5분 |
| skill-impl (브랜치 + 코드 + 검증 + PR) | 10~15분 | ~7분 |
| skill-review-pr (3 에이전트 병렬 + 코멘트) | 5~10분 | ~5분 |
| skill-merge-pr (squash + 완료 처리) | 1~2분 | ~1분 |
| **합계** | 21~37분 | **~18분** |

**병목 분석**:
- db-designer 백그라운드 호출이 plan과 병렬 실행 → 메인 사이클 차단 0
- 3 에이전트 병렬 review (≤60초 timeout × 3 → 1분 내 완료)
- CI 미설정 환경(자기 PR + 로컬 검증)이므로 GitHub Actions 대기 시간 0

### 2.2 Quality (품질)

| 지표 | 값 | 비고 |
|------|-----|------|
| CRITICAL 이슈 | **0** | auto-fix 루프 미실행 |
| MAJOR 이슈 | 2 | 권고 사항 (BR-JOB-02 부분 인덱스 / BR-JOB-01 강제 정책) — 머지 차단 없음 |
| MINOR | 3 | CHECK 제약 / view_count 핫스팟 / 인덱스 중첩 |
| INFO | 11 | 후속 PR 추적 항목 |
| 첫 리뷰 통과 | ✅ | 재리뷰 0회, fix 루프 0회 |
| review fix 사이클 | 0회 | CANDID-031 H-W에 비해 깨끗한 사이클 |
| 라인 추정 정확도 | **-10%** | 추정 195 vs 실제 176 LOC — L-010 적용 효과 입증 |
| 라인 수 vs limit | 176 / 220 (80%) | 경고 범위(132~220) 안쪽 |
| 빌드/테스트 회귀 | 0 | 112 기존 테스트 모두 통과 |

**품질 점수 (정성 평가): A** — CRITICAL 0건, 추정 정확도 -10%, 회귀 0건.

### 2.3 Patterns (패턴)

#### 반복된 좋은 패턴 (Keep)

1. **단일 PR + schema-only**: CANDID-003(인증 도메인) → CANDID-004(공고 도메인) 동일 구조. 다음 CANDID-005(지원서 도메인)도 동일 적용 가능 → **표준 템플릿화 가치**
2. **db-designer 백그라운드 호출**: plan 단계에서 메인 컨텍스트 외 토큰 절약 + 설계 보강 (QuestionType 4종 + optionsJson + 추가 인덱스 도출)
3. **L-010 적용**: 추정 195 → 실제 176 (-10%) — review fix buffer 사전 반영이 정확도 향상에 기여
4. **lockedFiles 정확한 명시**: 충돌 검사가 0건임을 plan 단계에서 검증

#### 새로 등장한 패턴

1. **PostgreSQL 부분 인덱스 권고 (BR-JOB-02)**: `WHERE status = 'OPEN'` 조건 인덱스가 일반 복합 인덱스보다 size·성능 우위 — 향후 적용 가치
2. **plan 미결 결정사항(R1~R6)을 dependency-aware하게 위임**: CANDID-005에서 결정될 `application_answers.question_id` FK 정책을 *현재 task에 영향 0*인 상태로 미결로 기록 → throughput 보존 + risk 추적성 확보

#### 자주 수정된 파일

- `prisma/schema.prisma`: CANDID-002, 003, 008, 030, 031, **004** → 6회 변경 (도메인별 누적)
- `backlog.json`: 5회 변경 (lock claim → plan approved → PR created → completion) — 정상 워크플로우

### 2.4 Decisions (의사결정)

| # | 결정 | 근거 | 결과 |
|---|------|------|------|
| D1 | 단일 step (vs 다중 분할) | CANDID-003 선례 + schema-only + 195 LOC < 220 limit | ✅ 적합 (실제 176 LOC) |
| D2 | QuestionType 4종 사전 정의 (vs MVP 2종) | db-designer 권고 — 추후 enum 확장은 destructive (L-001) | ✅ 채택 (CANDID-005 사용 시 추가 마이그레이션 불필요) |
| D3 | 부분 인덱스 미적용 (현재) | CANDID-013에서 EXPLAIN 후 결정 권장 | ⏳ 후속 검증 대기 |
| D4 | slug 컬럼 도입 (PRD 외) | URL 친화 + i18n + US-JOB-001 URL 쿼리 상태 | ✅ 채택 |
| D5 | question CASCADE FK | 공고-질문 생명주기 일치 | ⚠️ 미결 (CANDID-005 RESTRICT/soft-archive 검토 위임) |
| D6 | 시드 데이터 미포함 | 어드민 도메인 부재 | ✅ 적합 (CANDID-005 또는 어드민 도구 도입 시 처리) |
| D7 | destructive guard 미적용 | 신규 테이블만 (L-001 N/A) | ✅ 적합 |

**기술 부채**:
- M002 view_count 동시성 (운영 단계에서 비동기 카운터/배치 집계 전환 시점 docs 메모 권장)
- M003 (status,closes_at) × (opens_at,status) 부분 중첩 (실제 쿼리 패턴 확정 후 EXPLAIN으로 1개 제거 검토)
- H001 BR-JOB-02 부분 인덱스 (CANDID-013 EXPLAIN 후 결정)
- H002 BR-JOB-01 Repository helper 강제 정책 (CANDID-013/014 시점 도입)

### 2.5 Lessons (교훈)

#### Keep (계속하기)

- **db-designer 백그라운드 호출 패턴**: 메인 컨텍스트 토큰 절약 + 설계 보강 효과 입증
- **schema-only 단일 step 표준 워크플로우**: CANDID-003/004 일관, 005에도 적용 가능
- **review fix buffer 사전 반영(L-010)**: 추정 정확도 ±10% 달성 — 다음 task plan에 계속 적용
- **plan 단계 미결 결정사항 명시 위임**: throughput을 해치지 않고 후속 task에 hook 제공

#### Improve (개선하기)

- **자기 PR 리뷰 inline 코멘트 미작성**: H001/H002 권고를 일반 PR 코멘트로만 기록. 향후 `gh api .../pulls/{N}/comments`로 inline 코멘트 추가 시 후속 PR 추적성 향상 (현재는 PR description + 리뷰 코멘트에서만 확인 가능)
- **시간대 일관성**: 메타데이터 timestamp에서 UTC vs KST 혼동(`06:30:10+09:00`은 실제 KST 15:30 — 단순 표기 실수). 향후 `date +"%Y-%m-%dT%H:%M:%S%:z"` 표준 사용

#### Learn (배우기)

- **PostgreSQL 부분 인덱스 패턴**: `CREATE INDEX ... ON tbl(...) WHERE status = 'X'` — 특정 status 필터링 쿼리에 특화. 일반 복합 인덱스보다 size·성능 우위. BR-JOB-02 같은 "OPEN만 검색" 패턴의 표준 접근법
- **enum 확장은 destructive — 초기 정의 시점 비용이 최저**: QuestionType 4종 사전 도입이 추후 enum 추가 마이그레이션(L-001 guard 대상)을 회피
- **CASCADE FK는 child→parent 생명주기 일치 시점에만 적절**: 자식 entity가 *역방향 reference*를 가진 다른 child(예: application_answers)와 충돌 가능 → plan 단계에서 reverse dependency graph 검토 필요

#### Try (시도해보기)

- **다음 task(CANDID-005)에서 schema-only 단일 step 패턴 재적용** + R1 결정 (FK 정책)을 plan 단계에서 확정
- **CANDID-013 plan 단계에서 EXPLAIN 검증 스텝 명시**: H001 부분 인덱스 채택 결정의 근거 데이터 생산
- **자기 PR도 inline 코멘트로 권고 위치 마킹** — 후속 PR(같은 파일 수정 시) IDE에서 직접 참조 가능

## 3. Action Items

| # | 액션 | 대상 Task | 우선순위 |
|---|------|----------|---------|
| A1 | `application_answers.question_id` FK 정책 (RESTRICT 또는 soft-archive) plan 단계 확정 | CANDID-005 | P0 |
| A2 | 공고 조회 API에서 EXPLAIN 검증 + 부분 인덱스 채택 결정 | CANDID-013 | P1 |
| A3 | Repository helper에서 `where: { status: 'OPEN' }` 강제 + ESLint rule 또는 컨벤션 추가 | CANDID-013/014 | P1 |
| A4 | `docs/security/job-content-html-policy.md` SSOT 신설 (BR-JOB-04 양방향 sanitize) | CANDID-014 | P2 |
| A5 | view_count 비동기 카운터/배치 집계 전환 시점 docs 메모 | (운영 단계) | P2 |
| A6 | prisma/seed.ts:15의 jobCategory.upsert 활성화 (통합 테스트 fixture용) | CANDID-005 | P2 |

## 4. 학습 항목 후보 (lessons-learned.json 반영)

| ID | Category | 제목 | Impact |
|----|----------|------|--------|
| L-010 (기존) | process | 라인 추정 정확도 +-10% 달성 — appliedCount +1 | medium (유지) |
| L-012 (신규) | process | db-designer 백그라운드 호출 패턴 — plan 단계 토큰 절약 + 설계 보강 | medium |
| L-013 (신규) | architecture | PostgreSQL 부분 인덱스(WHERE status='X') — 특정 필터 쿼리 size·성능 우위 | medium |
| L-014 (신규) | process | enum 확장은 destructive — 초기 정의 시점에 사전 정의 비용이 최저 | medium |
| L-015 (신규) | architecture | CASCADE FK 결정 시 reverse dependency graph 검토 필수 | high |

---

**리포트 경로**: `docs/retro/CANDID-004-retro.md`
