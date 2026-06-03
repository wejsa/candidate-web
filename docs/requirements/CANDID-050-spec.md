# CANDID-050 — 공고 탐색/지원 여정 UI 재구성 + 인증 UI 보강

> 상태: 요구사항 정의 (승인 대기)
> Phase: PHASE-2 (핵심 도메인 — 지원 여정 완결) · 우선순위: high · 예상 스텝: 4
> Task 유형: feature (UI 재구성 + 결함 수정 포함)

## 1. 개요

공고 목록(`/jobs`)·상세(`/jobs/[id]`)의 UI를 [coupang.jobs](https://www.coupang.jobs/kr/jobs/) 채용 보드 패턴을 참고해 재구성하고, 현재 깨져 있는 **공고 탐색 → 로그인 → 지원** 여정의 결함을 메운다.

현재 컴포넌트는 className 없는 bare semantic HTML + 전역 element-selector CSS(CANDID-028 a11y 파운데이션)로 작성되어 있다. 본 Task는 그 위에 **CSS Modules + 기존 디자인 토큰(`--color-*`) 확장**으로 컴포넌트 스타일을 도입한다(새 외부 의존성 없음 — Next.js 내장 CSS Modules 사용). 기존 토큰·a11y 규칙·:focus-visible·반응형 컨테이너는 보존한다.

## 2. 목적 (해결할 문제)

| # | 현상 | 근본 원인 | 코드 위치 |
|---|------|----------|----------|
| P1 | `/jobs` 목록의 카드 내용(제목·직군·고용형태·경력·D-Day)이 **전부 파란 하이퍼링크**로 보임 | 카드 전체를 단일 `<Link>`로 감싸 내부 텍스트가 전역 `a` 스타일(링크색)을 상속 | `app/jobs/_components/JobCard.tsx:26` |
| P2 | 상세(`/jobs/6`)에서 **"로그인하고 지원하기"가 동작하지 않음**(404) | ApplyCta GUEST가 `/login?redirect=...`로 보내나 **`/login` 페이지 자체가 없음**. 백엔드 인증 API는 모두 존재 | `app/jobs/[id]/_components/ApplyCta.tsx:60` / 없는 라우트 `app/login` |
| P3 | "지원 완료" 상태의 "마이페이지에서 확인"도 404 | ApplyCta가 `/mypage`로 링크하나 실제 라우트는 `/me` | `ApplyCta.tsx:43` |
| P4 | 회원가입 UI 페이지 부재 | 백엔드 `/api/v1/auth/signup`만 존재, `/signup` 페이지 없음 | 없는 라우트 `app/signup` |
| P5 | 전역 헤더/네비게이션 부재 — 로그인 상태·로그아웃·홈/공고 이동 동선 없음 | `app/layout.tsx`에 skip-link만 존재 | `app/layout.tsx` |
| P6 | 전반적으로 시각 위계·여백·카드/칩 디자인이 빈약 | bare semantic HTML, 컴포넌트 스타일 부재 | `app/jobs/**` |

## 3. 기능 요구사항

| ID | 설명 | 우선순위 | 수용 기준 |
|----|------|---------|----------|
| **FR-001** | JobCard 링크 범위 정정 + 카드 디자인 | P0 | 카드에서 **네비게이션 가능한 접근성 링크는 1개(제목/카드 표면)** 만 존재. 직군·고용형태·경력은 **비링크 칩/메타 텍스트**로 렌더(링크 색 상속 차단). 카드 클릭 시 `/jobs/[id]` 이동. 키보드 포커스·스크린리더 레이블(기존 `aria-label`) 유지. CSS Modules 적용. |
| **FR-002** | ApplyCta 라우트 버그 수정 | P0 | ALREADY_APPLIED의 "마이페이지에서 확인" 링크가 `/me`(또는 `/me/[applicationId]`)로 이동. `/mypage` 잔존 0건(grep). |
| **FR-003** | 로그인 페이지 `/login` | P0 | 이메일/비밀번호 로그인 폼 + 소셜 로그인 진입(기존 `/api/v1/auth/oauth/[provider]`). `?redirect=` 파라미터가 **내부 경로일 때만** 성공 후 복원(open-redirect 방지: `/`로 시작 + `//`·스킴 차단, 위반 시 `/me`). 실패 시 표준 에러 코드(`AUTH_INVALID_CREDENTIALS`·`AUTH_ACCOUNT_LOCKED`·`AUTH_EMAIL_NOT_VERIFIED`) 메시지 노출. 5회 실패 잠금(BR-AUTH-03)은 서버가 처리, UI는 메시지만. |
| **FR-004** | 회원가입 페이지 `/signup` | P0 | 이메일/비밀번호/PII(이름·연락처 등) 입력 폼 → `/api/v1/auth/signup` 호출 → **이메일 인증 안내 화면**. 중복 이메일(`USER_EMAIL_DUPLICATED`) 메시지. 비밀번호 정책 안내. 가입 후 로그인 동선 제공. |
| **FR-005** | 전역 헤더/네비게이션 | P1 | `app/layout.tsx`에 헤더 추가: 로고(홈), "채용 공고"(/jobs), **인증 상태별 우측 영역**(비로그인: 로그인/회원가입 / 로그인: 마이페이지·로그아웃). 로그아웃은 `/api/v1/auth/logout`. 모바일 반응형. skip-link·`<main id="main-content">` 구조 보존. |
| **FR-006** | `/jobs` 목록 재구성 (coupang 참고) | P1 | 상단 히어로/타이틀 영역 + **필터 영역(직군·고용형태·경력·정렬)을 칩/셀렉트로 시각화**(기존 `JobFilters` 동작·쿼리스트링 계약 유지) + **카드 그리드**(반응형 1→2→3열). 마감 공고 섹션 시각 구분. 빈 목록/로딩 상태 디자인. 데이터 계약(`lib/jobs/list.ts`)·SEO·`aria` 유지. |
| **FR-007** | `/jobs/[id]` 상세 재구성 | P1 | 헤더(제목 + 직군·고용형태·경력·마감 **칩**) + 본문(sanitize된 `contentHtml`) + **스티키/강조된 지원 CTA** + 공유. JSON-LD(JobPosting)·`force-dynamic`·sanitize·`runtime=nodejs` 보존. 모바일에서 CTA 접근성 유지. |
| **FR-008** | CSS Modules + 디자인 토큰 확장 컨벤션 | P1 | `globals.css`에 카드/칩/버튼/헤더용 토큰(spacing·shadow·surface 등) 추가, 컴포넌트는 `*.module.css`로 스타일. 기존 토큰·a11y 규칙 비파괴. `_base/conventions`에 "CSS Modules 사용 지침" 1항 추가(선택). |

## 4. 비기능 요구사항

### 성능
- 공고 목록/상세 **P95 < 300ms**(NFR 목표) 유지. SSR/SSG·`unstable_cache(60s)` 경계 비파괴. CSS Modules는 빌드타임 처리 — 런타임 비용 없음.

### 보안
- **통신 방식: REST**(기존 `/api/v1/auth/*` 재사용 — 실시간/스트리밍 요건 없음).
- 로그인/회원가입 폼: 비밀번호를 **로그·URL·클라이언트 상태 영속화 금지**. 제출은 POST 본문.
- **Open-redirect 방지**: `?redirect=`는 내부 절대경로(`/`로 시작, `//`·`http(s):` 차단)만 허용.
- PII(이름·연락처·생년월일): 회원가입 입력은 기존 `encryptUserPiiInput` 경로(서버) 통과 — UI는 평문 전송(HTTPS) 후 서버 암호화. 응답 마스킹 유지.
- 인증 쿠키(httpOnly) 기반 — 토큰을 JS 접근 가능 저장소에 보관 금지.

### 접근성 / 반응형
- **WCAG 2.1 AA 유지**(CANDID-028): 대비비, :focus-visible, 터치 타깃 44px, reduced-motion, 320~1920px 반응형. 신규 컴포넌트는 vitest-axe 통과.
- 칩/카드는 색만으로 의미 전달 금지(텍스트 레이블 병행).

### SEO
- `/jobs`·`/jobs/[id]` SSR/SSG + JobPosting JSON-LD 보존. 마감 공고 SEO 자산 유지(BR-JOB-02). canonical/OG 메타 비파괴.

## 5. 기술 스펙

### 영향 범위
- **수정**: `app/jobs/_components/JobCard.tsx`, `JobFilters.tsx`, `ClosedJobsSection.tsx`, `Pagination.tsx`, `app/jobs/page.tsx`, `app/jobs/[id]/page.tsx`, `app/jobs/[id]/_components/*`(ApplyCta·Header·Body·Share), `app/layout.tsx`, `app/globals.css`.
- **신규**: `app/login/page.tsx`(+폼 컴포넌트), `app/signup/page.tsx`(+폼 컴포넌트), 전역 헤더 컴포넌트(`app/_components/SiteHeader.tsx` 등), 각 컴포넌트의 `*.module.css`, 공용 UI 프리미티브(Button/Chip/Card) 선택.
- **변경 없음**: 백엔드 API(`app/api/v1/auth/*`, `/api/v1/jobs`), `lib/jobs/*` 데이터 계약, prisma 스키마, 인증 로직(`lib/auth/*`).

### 의존성
- **새 외부 패키지 없음**. CSS Modules는 Next.js 내장. 기존 인증 API/`getOptionalAuthFromCookies`/`resolveApplyCta` 재사용.

### 통신 방식
- **REST** (단방향 요청/응답). 실시간/양방향 요건 없음.

### API 변경
- **없음**. 기존 엔드포인트 UI 배선만 추가.

### 예상 스텝 (skill-plan에서 확정)
1. **Step 1 — 결함 수정(P0)**: JobCard 링크 범위 정정(FR-001 구조) + ApplyCta `/mypage→/me`(FR-002). 회귀/컴포넌트 테스트. *작은 PR.*
2. **Step 2 — 인증 UI**: `/login`(redirect 복원·open-redirect 가드) + `/signup`(이메일 인증 안내)(FR-003/004) + 헤더 인증 동선(FR-005). E2E: 비인증 지원→로그인→복원.
3. **Step 3 — `/jobs` 목록 재구성**: CSS Modules 카드 그리드·필터 칩·상태 디자인(FR-006) + 토큰 확장(FR-008). a11y/SEO 회귀.
4. **Step 4 — `/jobs/[id]` 상세 재구성**: 칩 헤더·스티키 CTA·본문 레이아웃(FR-007). JSON-LD/sanitize 보존 회귀.

> 각 스텝 500라인 미만 목표. skill-plan이 라인 한도·순서·파일을 최종 확정.

## 6. 테스트 계획

- **단위/컴포넌트(RTL)**: JobCard(링크 1개·칩 비링크), ApplyCta(상태별 목적지), LoginForm(redirect 가드·에러 코드 표시), SignupForm(중복 이메일·인증 안내), SiteHeader(인증 상태 분기).
- **접근성(vitest-axe)**: 신규 컴포넌트 page-scope 위반 0.
- **E2E(Playwright, CANDID-048 기반 확장)**: ① 비인증 `/jobs/[id]` → "로그인하고 지원하기" → `/login` → 로그인 → `/jobs/[id]/apply` 복원 ② 카드 클릭 → 상세 진입 ③ 회원가입 → 이메일 인증 안내 ④ 헤더 로그인/로그아웃 토글.
- **회귀**: SEO 메타·JSON-LD·`unstable_cache` 경계, JobFilters 쿼리스트링 계약.
- 커버리지: 단위 80%+, 주요 플로우(로그인→지원) 100%.

## 7. 참고자료

- **UI 레퍼런스**: [coupang.jobs/kr/jobs](https://www.coupang.jobs/kr/jobs/) — 상단 네비 + 히어로/검색, 필터(직군·지역·고용형태) 칩/드롭다운, 직무 카드 리스트(제목 + 팀·위치 메타, 비링크), 상세의 강조된 Apply CTA.
- 기존 자산: `app/globals.css`(CANDID-028 디자인 토큰·a11y), `lib/jobs/apply-cta.ts`(5-state), `lib/auth/*`, `app/api/v1/auth/*`.
- 관련 BR/NFR: BR-AUTH-03(5회 잠금)·BR-AUTH-04(미인증 제출 차단)·BR-PII-01(PII 마스킹)·NFR(P95<300ms, WCAG 2.1 AA, SEO SSR/SSG).
- 선행/연관 Task: CANDID-013/014(공고 목록·상세), CANDID-028(a11y 파운데이션), CANDID-048(E2E), CANDID-049(`/jobs` 크래시 수정).

## 8. 미결/가정

- 회원가입 PII 입력 필드 범위(이름·연락처·생년월일·주소)는 기존 `/api/v1/auth/signup` 스키마(`lib/auth/validation.ts`)를 따른다 — skill-plan에서 실제 필드 확정.
- 소셜 로그인 버튼 노출 provider는 기존 `oauth/[provider]` 지원 목록을 따른다.
- coupang.jobs의 정확한 픽셀 복제가 아닌 **레이아웃/정보 위계 패턴 참고** — 자사 디자인 토큰 범위 내 재구성.
