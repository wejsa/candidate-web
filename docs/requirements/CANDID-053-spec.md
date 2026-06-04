# CANDID-053 — 관리자/리크루터 인증·권한(RBAC) + 백오피스 (A안: 내부 흡수)

> 상태: 요구사항 정의 (승인 대기) · 유형: feature(epic) · Phase 4 · 우선순위: medium
> 아키텍처 결정: **A안 — candidate-web 내부에 RBAC를 흡수**(별도 백오피스 서비스 분리하지 않음)

## 개요

현재 candidate-web에는 운영자(관리자/리크루터) 개념이 전무하다. `User`에 역할 필드·enum 없음, 권한 미들웨어(`requireRole`) 없음, `/admin` 페이지·API 없음. `AUTH_FORBIDDEN`은 리소스 소유권 검사와 `/api/metrics` 토큰 게이트에만 쓰인다. 그 결과 ATS의 "운영자 측" 흐름이 코드상 부재하다:

- **공고**: read-only — 쓰기 엔드포인트 0개, `seed`/직접 DB로만 생성
- **전형 진행**: `SUBMITTED`/`WITHDRAWN` 외 단계 전이(`DOC_REVIEW`→`INTERVIEW_1/2`→`OFFER`→`HIRED`/`REJECTED`) 및 `ApplicationResult`(`PASSED`/`FAILED`) 변경 경로 0개
- **면접 일정**: `InterviewSchedule` 모델은 있으나 생성 코드 0건(.ics·타임라인은 표시만)

스키마(`StageType`·`ApplicationStatusHistory.changedBy`·`InterviewSchedule`·`AuditEventType`)는 운영자 워크플로를 예견해 두었으므로, A안은 이를 채우는 방향이다.

## 목적

1. 운영자(ADMIN/RECRUITER)가 **앱 내에서** 공고를 관리하고 지원자 전형을 진행할 수 있게 한다.
2. 운영자 권한을 **최소권한 + 명시적 부트스트랩**으로 안전하게 발급·관리한다(self-signup으로 운영자 승격 불가).
3. 운영자의 광범위한 PII 접근을 **전수 감사 + 마스킹 기본**으로 통제한다(개인정보보호법 정합).
4. 기존 지원자용 `/api/v1/*` 계약을 **무변경**으로 유지한다(하위호환).

## 기능 요구사항

| ID | 설명 | 우선순위 | 수용 기준 |
|----|------|---------|----------|
| **FR-001** | 역할 모델: `User`에 `role UserRole @default(CANDIDATE)` 추가. enum `CANDIDATE/RECRUITER/ADMIN`. 마이그레이션은 기존 행 전부 CANDIDATE 백필 | High | 마이그레이션 후 기존 25+ 사용자 role=CANDIDATE. 신규 가입은 항상 CANDIDATE |
| **FR-002** | 권한 미들웨어 `requireRole(request, ...roles)` — `requireAuth` 위에 역할 로드, 불충족 시 `AUTH_FORBIDDEN`(403). `AuthContext`에 `role` 포함 | High | CANDIDATE가 `/api/admin/*` 호출 → 403. 미인증 → 401 선행 |
| **FR-003** | 관리자 부트스트랩: self-signup으로 staff 불가. 최초 ADMIN은 **CLI 스크립트**(`pnpm tsx scripts/admin/grant-role.ts <email> ADMIN`)로 승격. env 화이트리스트는 보조 | High | signup API는 role 입력 무시. CLI로만 ADMIN 생성. 실행은 감사 로그 기록 |
| **FR-004** | 역할 관리: ADMIN이 사용자 role 승격/강등(RECRUITER↔CANDIDATE). 자기 자신 강등·마지막 ADMIN 강등 차단 | High | ADMIN이 RECRUITER 승격 가능. 본인/최후 ADMIN 강등 시 거부(전용 에러) |
| **FR-005** | 공고 관리 CRUD: 생성/수정/상태전환(`DRAFT`↔`OPEN`→`CLOSED`). RECRUITER 이상 | High | DRAFT 생성→OPEN 공개→지원자 노출. CLOSED 후 신규 지원 차단(기존 BR-APP 정합) |
| **FR-006** | 지원자 목록/상세(운영자 뷰): 공고별 지원자 리스트(페이지네이션) + 상세(스냅샷 PII는 마스킹 기본, 명시적 열람 시 복호화+감사) | High | 목록은 PII 마스킹. 상세 PII 열람 시 `PII_VIEW` 감사 1건 |
| **FR-007** | 전형 단계 전이: 허용 전이 그래프 검증 + `ApplicationStatusHistory` write(`changedByUserId`=운영자) + `ApplicationResult` 결정(`PASSED`/`FAILED`). 불법 전이 거부 | High | `SUBMITTED→DOC_REVIEW→INTERVIEW_1` 정상. `SUBMITTED→HIRED` 등 점프 거부. WITHDRAWN은 전이 불가 |
| **FR-008** | 면접 일정 생성/변경: `InterviewSchedule` writer 신설(`icsUid` 멱등). 지원자 마이페이지 타임라인/.ics에 즉시 반영 | Medium | 면접 생성 → 지원자 `/me/{id}`에 노출 + .ics 다운로드 정상 |
| **FR-009** | 감사 확장: `AuditEventType`에 `ROLE_GRANTED/ROLE_REVOKED`, `JOB_POSTING_CREATED/UPDATED/STATUS_CHANGED`, `APPLICATION_STAGE_CHANGED`, `INTERVIEW_SCHEDULED/UPDATED` 추가. 운영자 actor 기록 | High | 각 운영자 변경마다 감사 1건(actorUserId=운영자) |
| **FR-010** | 백오피스 UI `/admin/*`(공고 관리·지원자 진행·면접 일정). 미들웨어로 비운영자 진입 차단(→ 로그인/403). 지원자 UI와 레이아웃 분리 | Medium | RECRUITER 로그인 → `/admin` 진입. CANDIDATE 진입 → 차단 |
| **FR-011** | 운영자 보안 통제: 운영자 작업 전용 rate-limit, 운영자 PII 열람 전수 감사, 운영자 계정도 BR-AUTH-03 잠금/세션 정책 동일 적용 | High | 운영자 PII 열람 100% 감사. 운영자 5회 실패 잠금 동일 |

## 비기능 요구사항

### 성능
- 지원자 목록: 커서/오프셋 페이지네이션 + `(jobPostingId, currentStage)` 인덱스. P95 < 500ms(운영자 100건/페이지 기준).
- 전이/면접 쓰기는 단일 트랜잭션(상태 + 이력 1건).

### 보안 (핵심 — PR 리뷰 CRITICAL 대상)
- **최소권한 & 권한 상승 차단**: signup/profile API는 role을 절대 수용하지 않음. role 변경은 ADMIN 전용 + 본인·최후 ADMIN 가드.
- **부트스트랩 안전성**: ADMIN은 코드 경로(self-service)로 생성 불가 — CLI/seed로만. CLI 실행 감사.
- **운영자 PII**: 목록은 마스킹 기본. 상세 평문 열람은 명시적 액션 + `PII_VIEW` 감사(BR-PII-01). 평문 PII는 로그/감사 metadata에 절대 미기록(기존 db-designer §4 정합).
- **격리**: `/api/admin/*`는 `requireRole` 가드. 기존 `/api/v1/*`는 무변경(운영자도 지원자 자원엔 소유권 규칙 그대로).
- **감사 불변성**: 운영자 모든 변경은 `recordAuditEvent`로 영속(fire-and-forget 아님 — 중요 변경은 트랜잭션 내).

### 확장성
- 역할 세분화(예: INTERVIEWER) 여지를 enum + 미들웨어 가변인자로 확보.
- 향후 staff를 별도 `Staff` 테이블로 분리할 마이그레이션 경로 문서화(A안은 MVP로 `User.role` 채택).

## 기술 스펙

### 영향 범위
- `prisma/schema.prisma`: `UserRole` enum, `User.role`, `AuditEventType` 확장, 마이그레이션(백필 포함)
- `lib/auth/middleware.ts`: `requireRole` + `AuthContext.role`
- `lib/admin/*` (신규): 역할 관리, 공고 서비스, 전형 전이 그래프, 면접 서비스
- `app/api/admin/*` (신규): jobs CRUD, applications 목록/상세/전이, interviews
- `app/admin/*` (신규): 백오피스 UI
- `lib/errors/codes.ts`: 필요 시 `ADMIN_*`/`USER_LAST_ADMIN` 등 신규 코드(SSOT 갱신)
- `scripts/admin/grant-role.ts` (신규): 부트스트랩 CLI
- `prisma/seed.ts`: 선택적 개발용 ADMIN 시드

### 의존성
- 신규 외부 의존성 **없음**(기존 jwt/bcrypt/prisma/audit 재사용).
- 선행: 없음(에픽 자체가 기반). 단, A안/B안 아키텍처 결정은 본 spec으로 **A안 확정**.

### 통신 방식
- **REST** — 표준 CRUD. 실시간/양방향/스트리밍 요구 없음.

### API 변경
- **신규**: `/api/admin/v1/*` 네임스페이스(예: `POST /api/admin/v1/job-postings`, `PATCH /api/admin/v1/applications/{id}/stage`, `POST /api/admin/v1/applications/{id}/interviews`, `PATCH /api/admin/v1/users/{id}/role`).
- **기존 `/api/v1/*` 무변경** — 지원자 계약 하위호환 보장.

## 테스트 계획
- 단위: `requireRole` 분기(403/통과), 전이 그래프(합법/불법), 최후 ADMIN 강등 가드, 부트스트랩 CLI.
- 통합: 공고 CRUD, 전형 전이+이력 트랜잭션, 면접 생성→지원자 타임라인 반영, 권한 격리(CANDIDATE→admin 403).
- E2E(Playwright, headed): 운영자 로그인→공고 발행→지원자 진행→면접 등록 흐름 + 비운영자 차단. (기존 `e2e/helpers/db.ts` role 셋업 재사용)
- 보안 회귀: signup/profile로 role 주입 시도 차단, 운영자 PII 열람 감사 발생.

## 예상 스텝 (skill-plan에서 확정)
1. 역할 모델 + 마이그레이션(백필) + `requireRole` + 부트스트랩 CLI (FR-001~004)
2. 공고 관리 CRUD API + 권한 가드 (FR-005)
3. 지원자 목록/상세 + 운영자 PII 통제 (FR-006, FR-011 일부)
4. 전형 단계 전이 그래프 + 이력 + 결과 결정 (FR-007)
5. 면접 일정 writer + 지원자 반영 (FR-008)
6. 감사 이벤트 확장 통합 (FR-009)
7. 백오피스 UI `/admin/*` (FR-010)
> 규모상 6~8개 PR로 분리 예상. skill-plan이 라인 제한 기준 재분리.

## 참고자료
- 미결 정책: PRD §8 (면접관 이름 노출 등 — 운영자 데이터 노출 정책 의사결정 연계)
- 도메인 규칙: CLAUDE.md BR-APP-*/BR-PII-*/BR-AUTH-03
- 기존 모델: `prisma/schema.prisma`(`StageType`, `ApplicationResult`, `InterviewSchedule`, `ApplicationStatusHistory`, `AuditEventType`, `JobStatus`)
- 권한 게이트 선례: `lib/auth/middleware.ts`(`requireAuth`), `lib/errors/codes.ts`(`AUTH_FORBIDDEN`)
