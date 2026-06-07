# CANDID-054 — 백오피스(어드민) UX 강화: 전체 너비 레이아웃 + 지원자 대시보드

- **Task ID**: CANDID-054
- **유형**: feature (enhancement)
- **Phase**: 4 (운영/품질)
- **우선순위**: medium
- **의존성**: CANDID-053 (관리자 RBAC + 백오피스 — done)
- **작성일**: 2026-06-07

---

## 1. 개요

CANDID-053에서 백오피스 골격(셸/공고 CRUD/지원자 목록·상세/전형 전이/면접 일정)이 완성되었으나, 운영 화면이 **좁은 본문 컬럼에 갇혀** 있고 지원자 현황을 **한눈에 파악할 수 없는** 단순 페이지네이션 테이블에 머물러 있다. 본 Task는 운영자의 일상 작업 효율을 높이는 **UI/UX 강화**다. 신규 도메인 로직·권한 변경 없이, 기존 RBAC 가드·마스킹·감사 정책을 그대로 유지한 채 레이아웃과 정보 밀도를 개선한다.

### 현재 문제 (진단)
1. **너비 제약**: 전역 `app/globals.css`의 `main { max-width: var(--content-max) /* 760→880px */; margin: 0 auto }`가 어드민 콘텐츠(`<main className={styles.content}>`)에도 적용된다. 셸 그리드(`220px 1fr`)의 콘텐츠 컬럼 안에서 880px로 가운데 정렬되어, 1440px+ 화면에서 좌우 여백이 과도하고 테이블이 좁다.
2. **지원자 목록**: 단계별 분포·총계 요약이 없는 20건/페이지 테이블 + 단계 필터 링크(카운트 없음). 운영자가 "현재 어느 단계에 몇 명"인지 스크롤·페이지 이동 없이 알 수 없다.
3. **운영 대시보드 홈(`/admin`)**: 진입 카드 1개만 있고 라이브 지표가 전무하다.

---

## 2. 목적

- 운영자가 **넓은 화면을 활용**해 더 많은 정보를 한 화면에서 처리한다.
- 공고별 지원자 현황을 **대시보드(요약 KPI + 분포)**로 즉시 파악한다.
- 백오피스 첫 진입(`/admin`)에서 **전사 채용 현황 스냅샷**을 제공한다.

---

## 3. 기능 요구사항

| ID | 설명 | 우선순위 | 수용 기준 |
|----|------|---------|----------|
| **FR-001** | **어드민 전체 너비 레이아웃** — `/admin/**` 콘텐츠가 전역 `main` 760/880px 캡을 벗어나 셸 콘텐츠 컬럼 전체 폭을 채운다. 사이드바(220px) + 콘텐츠(잔여 전체). **최대 폭은 `--container`(1200px) 캡** — 셸 전체를 1200px 컨테이너에 담아 가운데 정렬(초대형 모니터에서 줄 길이 과다 방지). | High | 1440px 뷰포트에서 공고관리 테이블이 1200px 컨테이너 전체로 확장(880px 중앙 여백 제거). 320~1920px에서 가로 오버플로 없음(WCAG 1.4.10 reflow 유지). ≤720px에서 사이드바가 상단으로 접히는 단일 컬럼 유지. |

> **확정(2026-06-07)**: 너비 = **1200px 캡**(fluid 아님). 범위 = **FR-001~FR-004 전체**.
| **FR-002** | **지원자 대시보드** — 공고별 지원자 페이지(`/admin/job-postings/[id]/applicants`)를 대시보드화. (a) 상단 요약 KPI: 총 지원 수, 전형 단계별 카운트(`DOC_REVIEW`/`INTERVIEW_1`/`INTERVIEW_2`/`OFFER`/`HIRED`/`REJECTED`), 결과별(`PASSED`/`FAILED`/진행중). (b) 단계 필터를 **카운트 뱃지가 붙은 칩/탭**으로 전환. (c) 테이블 정보 밀도·페이지 크기 상향(50건). | High | 페이지 진입 시 단계별 분포를 스크롤 없이 파악 가능. 합계 = 단계별 합 = 결과별 합 정합. 필터 칩에 각 단계 인원수 표시. KPI는 단일 집계 쿼리(`groupBy`)로 계산. |
| **FR-003** | **운영 대시보드 홈 강화** — `/admin` 홈에 전사 요약 위젯 추가: 공고 상태별 수(DRAFT/OPEN/CLOSED), 전체 지원 수, 미처리(서류 검토 등 초기 단계) 큐 카운트, 최근 지원 N건(공고 링크). 기존 진입 카드는 유지. | Medium | 홈 진입 시 추가 쿼리 없이도(또는 경량 집계로) 핵심 지표 4종 노출. 권한 가드 유지. |
| **FR-004** | **공고 관리 목록 강화** — 넓어진 폭을 활용해 컬럼 보강(등록일·마감일 노출), 지원 수 강조. 기존 상태 전환·수정·지원자 링크 동작 보존. | Low | 컬럼 추가 후에도 좁은 화면에서 가로 스크롤로 접근 가능. 기존 E2E(admin.spec.ts) 회귀 없음. |

---

## 4. 비기능 요구사항

### 성능
- 대시보드 집계는 인덱스(`idx_applications_posting_stage`)를 활용한 단일 `groupBy` 쿼리로 N+1 회피. 목록 조회와 병렬(`Promise.all`).
- 운영 화면 목표 P95 < 300ms (지원자 대시보드 KPI + 목록 1페이지 합산).

### 보안 / 컴플라이언스
- 기존 RBAC 경계 불변: 모든 `/admin/**` 페이지·데이터는 `requireOperatorPage` 가드 뒤에서만 접근. 데이터 접근 직전 가드 재호출(defense-in-depth) 유지.
- **PII 노출 금지**: 대시보드 KPI/분포는 **카운트(집계 수치)만** 산출 — 평문 PII 미접촉, `basePrisma` 사용. 목록 행은 기존 마스킹(`maskName`/`maskEmail`) 유지. 평문 PII는 상세 페이지의 명시 열람(`PII_VIEW` 감사)에서만.
- 운영 화면 `robots: noindex` 유지.

### 접근성 (WCAG 2.1 AA)
- KPI 카드·필터 칩 색 대비 ≥ 4.5:1, 활성 필터는 색 외 단서(굵기/테두리) 병행.
- 넓은 테이블은 좁은 폭에서 가로 스크롤 컨테이너 + 키보드 접근 가능.
- 320~1920px reflow(1.4.10) 유지.

### 확장성
- 페이지 크기 상향 후에도 페이지네이션 계약 유지. 집계는 페이지와 무관하게 전체 기준.

---

## 5. 기술 스펙

### 영향 범위
- **레이아웃/스타일(FR-001)**: `app/admin/admin.module.css`, `app/admin/job-postings/job-postings.module.css` — 어드민 `<main>`의 전역 `max-width` 캡 override(`.content { max-width: none; margin: 0; }` 또는 셸 레벨 full-width 래퍼). 필요 시 `app/admin/layout.tsx` 콘텐츠 래퍼 도입.
- **지원자 대시보드(FR-002)**: `app/admin/job-postings/[id]/applicants/page.tsx`, `lib/admin/applicants.ts`(신규 집계 함수 `getApplicantStageStatsByPosting` — `groupBy(currentStage)` + `groupBy(result)`), 관련 CSS(KPI 카드/칩 — `applicants.module.css` 신규 또는 기존 모듈 확장).
- **대시보드 홈(FR-003)**: `app/admin/page.tsx`, `lib/admin/dashboard.ts`(신규 — 공고 상태별·지원 총계·최근 지원 집계).
- **공고 목록(FR-004)**: `app/admin/job-postings/page.tsx`, `app/admin/job-postings/job-postings.module.css`.

### 의존성
- CANDID-053 전체(done). 신규 외부 라이브러리 없음.

### 통신 방식
- **REST / RSC 직접 호출** (기존 패턴 유지). 운영 화면은 서버 컴포넌트에서 `lib/admin/*` read 함수를 직접 호출 — 신규 API 라우트 불필요. 실시간/스트리밍 요구사항 없음(집계는 `force-dynamic` RSC 매 요청 계산).

### API 변경
- 외부 HTTP API 변경 없음. 내부 lib 집계 함수만 추가.

### DB 변경
- 마이그레이션 없음. 기존 인덱스(`idx_applications_posting_stage`) 재사용. (집계 부하가 확인되면 후속 Task에서 인덱스 검토.)

---

## 6. 테스트 계획

- **단위(lib)**: `getApplicantStageStatsByPosting` — 단계/결과 groupBy 매핑, 0건 공고, 단계 누락 시 0 채움, 합계 정합. `lib/admin/dashboard.ts` 집계 — 상태별 카운트·최근 지원 정렬.
- **회귀(E2E)**: `e2e/admin.spec.ts` 확장(선택) — 지원자 대시보드 KPI 노출, 권한 차단 유지, 전체 너비 진입.
- **RSC 페이지 테스트**: 기존 프로젝트 패턴(jsdom/RSC 인프라 부재)에 따라 lib 단위 테스트로 대체. 비주얼/너비는 수동 또는 E2E 스냅샷.
- 커버리지 목표: 신규 lib 함수 80%+.

---

## 7. 참고자료

- CANDID-053 spec: `docs/requirements/CANDID-053-spec.md` (RBAC/백오피스 기반)
- 코드: `app/admin/**`, `lib/admin/applicants.ts`, `lib/admin/job-postings-list.ts`, `lib/auth/require-role-page.ts`
- 전역 레이아웃 토큰: `app/globals.css` (`--container` 1200px, `--content-max` 760/880px, `main` 캡)
- 비즈니스 규칙: BR-PII-01(마스킹), BR-APP-07(전형 단계), CLAUDE.md 보안 강제 사항

---

## 8. 예상 스텝 (참고 — crew-plan에서 확정)

1. **전체 너비 레이아웃**(FR-001) — 어드민 `main` 캡 override + 셸/반응형 정리. (~120 LOC)
2. **지원자 대시보드 집계 + 화면**(FR-002) — `getApplicantStageStatsByPosting` + KPI/칩 UI + 단위 테스트. (~450 LOC)
3. **대시보드 홈 + 공고 목록 강화**(FR-003·FR-004) — `lib/admin/dashboard.ts` + 홈 위젯 + 목록 컬럼. (~400 LOC)

> 총 3스텝 예상. crew-plan에서 LOC·분리 기준 재확정.
