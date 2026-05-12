# candidate-web v0.1.0

자사 채용 사이트 지원자 프론트엔드(Candidate Web). 이메일/소셜 회원가입, 채용 공고 조회, 지원서 작성·임시저장·제출, 마이페이지(전형 진행/철회)를 제공합니다.

---

## 프로젝트 개요

| 항목 | 값 |
|------|-----|
| **도메인** | 🔧 범용 (general) |
| **기술 스택** | Next.js 14 (TypeScript) + PostgreSQL/Prisma |
| **인프라** | docker-compose |

---

## 기술 스택

| 계층 | 선택 | 비고 |
|------|------|------|
| Backend | Node.js + TypeScript | Next.js Route Handlers / Server Actions |
| Frontend | Next.js 14 App Router | SSR/SSG, OG/structured data |
| Database | PostgreSQL | 부분 인덱스, JSON 컬럼, 트랜잭션 |
| Cache | 인메모리 | Next.js `unstable_cache` / lru-cache (외부 캐시 인프라 없음) |
| Message Queue | 없음 | 필요 시 DB outbox 또는 BullMQ |
| Infrastructure | docker-compose | db 서비스만 시작점 |
| Auth | OAuth2 + JWT | Google/GitHub OAuth2, Access 30분/Refresh 14일 |
| Security | BCrypt(12), AES-256-GCM | PII 컬럼 암호화, 응답 마스킹 |

---

## 에이전트 팀

| 에이전트 | 역할 |
|---------|------|
| pm | 요구사항 정의, 백로그 관리 |
| planner | 설계 분석, 스텝 분리 |
| backend | Next.js Route Handler, 비즈니스 로직 |
| frontend | App Router UI, 폼/상태 관리 |
| db-designer | DB 스키마 분석, ERD 검증 |
| qa | 테스트 품질 분석 |
| code-reviewer | 5관점 통합 PR 리뷰 |
| docs | 문서 영향도 분석 |

---

## 시작하기

### 개발 환경 셋업

```bash
# Node 버전 (.nvmrc 기준)
nvm use   # 또는 nvm install $(cat .nvmrc)

# 패키지 매니저 (pnpm)
corepack enable           # Node 16.10+ 권장
corepack prepare pnpm@9.15.0 --activate

# 의존성 설치 (postinstall에서 prisma generate 자동 실행)
pnpm install

# 환경 변수 (DATABASE_URL은 CANDID-002부터 필수)
cp .env.example .env.local
# .env.local 파일을 열어 시크릿/DB 연결 문자열 채우기

# 데이터베이스 (PostgreSQL 16)
pnpm db:up         # docker compose up -d db
pnpm db:migrate    # prisma migrate dev (스키마 적용)
pnpm db:seed       # 시드 데이터 (CANDID-002 시점은 no-op)
pnpm db:studio     # Prisma Studio GUI (선택)

# 개발 서버 (http://localhost:3000)
pnpm dev

# 빌드 / 테스트 / 린트
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check

# 정리
pnpm db:down       # docker compose down (볼륨 보존)
# 완전 초기화: docker compose down -v
```

### Database 운영 메모

- 마이그레이션 명령: 로컬은 `prisma migrate dev`, CI/운영은 `prisma migrate deploy`. **`db push`는 금지** (추적성 손실).
- 마이그레이션 파일 명명: `{timestamp}_candid-{NNN}-{설명}` (task 추적성).
- Prisma client는 `lib/prisma.ts`의 singleton 사용. **클라이언트 컴포넌트 import 금지** (`'server-only'` 가드).
- 운영 DB는 관리형 PostgreSQL 권장 (`DATABASE_URL`은 시크릿 매니저에서 주입).

### Claude Code 워크플로우

```bash
# Claude Code 실행
claude

# 상태 확인
/skill-status

# 백로그 확인 (29개 task 준비됨)
/skill-backlog

# 다음 작업 가져오기 → PHASE-1: CANDID-001부터
/skill-plan
```

---

## 디렉토리 구조

```
candidate-web/
├── project.json            # 프로젝트 설정 (도메인, 스택, 에이전트)
├── backlog.json            # 백로그 + 상태 + Phase
├── docs/
│   ├── sample-requirement.md  # 원본 PRD
│   ├── requirements/       # 세부 요구사항 (skill-feature가 추가)
│   ├── api-specs/          # API 명세 (OpenAPI)
│   ├── architecture/       # 아키텍처 문서
│   ├── security/           # 보안 문서
│   └── test-plans/         # 테스트 계획
├── CLAUDE.md               # AI 에이전트 지시문
├── VERSION                 # 프로젝트 버전
└── README.md               # 이 파일
```

---

## 주요 명령어

| 명령어 | 설명 |
|--------|------|
| `/skill-status` | 프로젝트 상태 확인 |
| `/skill-backlog` | 백로그 조회/관리 |
| `/skill-feature` | 새 기능 기획 |
| `/skill-plan` | 설계 + 스텝 계획 수립 |
| `/skill-impl` | 코드 구현 (스텝별) |
| `/skill-review-pr` | PR 리뷰 |
| `/skill-merge-pr` | PR 머지 |

---

## 백로그 요약 (29개 task / 4 phase)

| Phase | 이름 | Task 수 | 주요 산출물 |
|-------|------|---------|------------|
| 1 | 기반/인프라 | 9 | Next.js 셋업, DB 스키마, JWT, PII 암호화, Rate Limit |
| 2 | 핵심 도메인 | 10 | 회원가입/로그인/OAuth, 공고, 지원서 작성·제출, 마이페이지 |
| 3 | 부가 기능 | 6 | 비밀번호 재설정, 탈퇴/철회/프로필, SEO |
| 4 | 운영/품질 | 4 | 감사 로그, 메트릭, 접근성, 배치 |

> 상세 task 목록은 `backlog.json` 참조.

---

## Git 브랜치 전략

```
main (운영)
  └── develop (개발 통합)
        ├── feature/CANDID-XXX-stepN
        └── bugfix/CANDID-XXX-버그명
```

---

<!-- CUSTOM_SECTION_START -->

## 원본 요구사항

본 프로젝트의 비즈니스 요구사항은 `docs/sample-requirement.md`(PRD v1.0, 2026-05-11)에 정의되어 있습니다. PR 리뷰 시 도메인 에이전트가 자동 참조합니다.

핵심 사용자(Persona):
- **P1. 신규 지원자**: 빠른 가입 + 직관적인 작성 UX
- **P2. 재지원자**: 마이페이지에서 결과 확인 + 재지원
- **P3. 비로그인 탐색자**: SEO + OG 태그 최적화 대상

미결 정책 결정 사항: PRD §8 참조 — 휴대폰 본인 인증 도입, 탈퇴 시 진행 중 지원 처리, 소셜 자동 연결, 면접관 이름 노출 등은 의사결정자 검토 필요.

<!-- CUSTOM_SECTION_END -->

## 라이선스

(미정 — 회사 정책에 따라 LICENSE 파일 추가 필요)
