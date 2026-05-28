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

# 환경 변수 (DATABASE_URL은 CANDID-002, PII_ENCRYPTION_KEY는 CANDID-008부터 필수)
cp .env.example .env.local
# .env.local 파일을 열어 시크릿/DB 연결 문자열 채우기

# PII 암호화 키 생성 (AES-256-GCM)
openssl rand -hex 32
# 출력값을 .env.local의 PII_ENCRYPTION_KEY=... 자리에 붙여넣기 (운영용 키와 dev/staging 분리 필수)

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
pnpm test            # vitest 단위 테스트 (CANDID-008 도입)
pnpm test:coverage   # v8 커버리지 리포트 (lines/funcs/stmts 80% / branches 75% 임계)
pnpm test:integration # 실제 PostgreSQL DB + Prisma + piiExtension 통합 테스트 (CANDID-035, 아래 참조)

# 정리
pnpm db:down       # docker compose down (볼륨 보존)
# 완전 초기화: docker compose down -v
```

### Database 운영 메모

- 마이그레이션 명령: 로컬은 `prisma migrate dev`, CI/운영은 `prisma migrate deploy`. **`db push`는 금지** (추적성 손실).
- 마이그레이션 파일 명명: `{timestamp}_candid-{NNN}-{설명}` (task 추적성).
- Prisma client는 `lib/prisma.ts`의 singleton 사용. **클라이언트 컴포넌트 import 금지** (`'server-only'` 가드).
- 운영 DB는 관리형 PostgreSQL 권장 (`DATABASE_URL`은 시크릿 매니저에서 주입).
- **Destructive migration guard** (CANDID-030 부터): `DROP COLUMN` / 컬럼 `TYPE` 변경 같은 destructive ALTER는 SQL 본문 상단에 `COUNT(*) > 0` guard를 동반해야 한다 (`.claude/domains/_base/conventions/database.md` 참조).
- **CONCURRENTLY 회귀 가드** (CANDID-038 부터): `pnpm check:migrations` — 신규 `CREATE INDEX CONCURRENTLY` 감지 시 exit 1 (L-029, `_base/conventions/database.md` §"Prisma migrate deploy의 트랜잭션 wrap" 참조). **호출 시점/매핑 SSOT는 `.claude/skills/skill-review-pr/SKILL.md` §2.4** declarative 매핑 표 (CANDID-042부터 자동 호출 wiring). 신규 가드 추가 시 본 표에 행 등록 필수.
- ⚠ **이미 적용된 마이그레이션의 SQL 수정 시 Prisma hash mismatch**: 본 PR(CANDID-030)에서 `20260512210900_candid_008_pii_encryption/migration.sql`에 guard 추가 → 이미 적용된 dev DB에서는 `prisma migrate dev` 실행 시 drift 감지. dev 환경은 `prisma migrate reset`으로 재적용 권장 (운영 데이터 없음 가정 — CANDID-008 dev-only 마이그레이션 정합).

### 통합 테스트 (CANDID-035)

`pnpm test:integration`은 실제 PostgreSQL DB 위에서 Prisma + piiExtension wiring 회귀를 차단한다. dev 인스턴스를 재사용하되 `?schema=test_integration` 파라미터로 schema만 분리해 dev 데이터를 손상시키지 않는다.

```bash
# 1. PostgreSQL 기동 (postgres:16-alpine, docker-compose)
pnpm db:up

# 2. 통합 테스트 실행 (globalSetup에서 prisma migrate deploy --schema=test_integration 1회 자동 실행)
pnpm test:integration
```

- 단위 테스트(`pnpm test`)와 별도 runner(`vitest.config.integration.ts`) — 격리는 각 테스트 `beforeEach` `TRUNCATE ... RESTART IDENTITY CASCADE`.
- `TEST_DATABASE_URL`을 별도 환경 변수로 지정하면 다른 인스턴스 사용 가능 (`.env.example` 참조).
- `PII_ENCRYPTION_KEY`는 setup이 테스트 전용 고정 32B hex로 강제 주입 — 운영 키 누수 위험 0.
- `truncateAll()`은 매 호출마다 `current_schema() === 'test_integration'` fail-fast — schema override 실패 시 운영 데이터 사고 차단.
- CI workflow(`services.postgres` 매핑)는 본 task 범위 밖 — 별도 chore 위임 (Action Items A1).

**통합 테스트 범주** (CANDID-035 완료 기준):

| 파일 | 검증 |
|------|------|
| `prisma-smoke.test.ts` | DB 연결 + 5쌍 컬럼 메타 + truncate 격리 + piiExtension wiring 1줄 (H006) |
| `prisma-extends-application-write-guard.test.ts` | 5 query.application op string 평문 throw + BYTEA happy (V1) |
| `prisma-extends-application-roundtrip.test.ts` | 5쌍 round-trip + null + needs satisfies (V2 + V4) |
| `prisma-extends-application-nested-write.test.ts` | L-007 nested write 우회 SSOT 증거 (V3, fail = wiring 강화 신호) |
| `migrations-applications-schema.test.ts` | 5쌍 BYTEA + 5쌍 SMALLINT 컬럼명 정확 매칭 (V5, schema rename 회귀) |

### PII 처리 (CANDID-008)

`User.phone`, `User.birthDate`는 DB에 **AES-256-GCM ciphertext** (`BYTEA`)로 저장됩니다. 저장 포맷: `[iv 12B] || [authTag 16B] || [ciphertext]`. 키 버전은 별도 `phone_key_version` / `birth_date_key_version` `SMALLINT` 컬럼이 추적 (현재 v1).

**읽기 — 자동 복호화** (`lib/prisma/extends.ts`의 result extension):

```ts
import { prisma } from '@/lib/prisma';

const user = await prisma.user.findUnique({ where: { id } });
// user.phone, user.birthDate 모두 평문 string (또는 null)로 반환됨.
```

**쓰기 — 명시적 헬퍼** (`encryptUserPiiInput`):

```ts
import { prisma } from '@/lib/prisma';
import { encryptUserPiiInput } from '@/lib/prisma/extends';

await prisma.user.create({
  data: {
    email: 'foo@bar.com',
    name: 'foo',
    ...encryptUserPiiInput({ phone: '01012345678', birthDate: '1995-03-15' }),
  },
});
```

**응답 마스킹** (`lib/pii/mask.ts`) — API serializer 레이어에서 적용:

```ts
import { maskPhone, maskBirthDate } from '@/lib/pii/mask';

return Response.json({
  phone: maskPhone(user.phone),         // "010-****-5678"
  birthDate: maskBirthDate(user.birthDate), // "1995-**-**"
});
```

**주의 사항**:
- `prisma.$queryRaw` 등 raw query는 `$extends`를 거치지 않음 → 직접 `decryptUserPiiField(row.phone)` 호출 필요.
- 키 회전은 별도 마이그레이션(`*_key_version` 업데이트 + 백필) 필요. 현재 모듈은 v1 단일 키.
- 운영 진입 시 컬럼 타입 변경은 4단계 무중단 절차(M1 add → M2 backfill → M3 deploy → M4 drop+rename) 필수. dev-only 단일 마이그레이션은 PHASE-1에 한정.

> 📖 **상세 가이드**: 알고리즘 사양, 저장 포맷, 3-Layer Defense(D6/D7/D8), 키 회전 SOP(M1~M4), 사고 대응 절차, 컴플라이언스 매핑(개인정보보호법 §28 / GDPR Art. 32)은 [docs/security/pii-encryption.md](docs/security/pii-encryption.md) 참조.

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
