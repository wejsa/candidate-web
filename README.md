# candidate-web

자사 채용 사이트 지원자 프론트엔드. 이메일/소셜 회원가입, 채용 공고 조회, 지원서 작성·임시저장·제출, 마이페이지(전형 진행/철회)를 제공합니다.

## 기술 스택

- **Frontend / Backend**: Next.js 14 App Router (TypeScript, SSR/SSG, Route Handlers)
- **Database**: PostgreSQL 16 + Prisma
- **Auth**: OAuth2(Google/GitHub) + JWT (Access 30분 / Refresh 14일), BCrypt(12)
- **Security**: PII(연락처·생년월일) AES-256-GCM 컬럼 암호화 + 응답 마스킹
- **Infra**: docker-compose, 패키지 매니저 pnpm

## 빠른 시작

```bash
nvm use                       # .nvmrc 기준 Node
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install                  # postinstall에서 prisma generate

cp .env.example .env.local    # 시크릿/DB 연결 채우기
openssl rand -hex 32          # PII_ENCRYPTION_KEY 값 생성 → .env.local에 입력

pnpm db:up                    # PostgreSQL (docker compose)
pnpm db:migrate               # prisma migrate dev
pnpm db:seed                  # 시드 데이터

pnpm dev                      # http://localhost:3000
```

## 자주 쓰는 명령어

```bash
pnpm build / pnpm typecheck / pnpm lint / pnpm format:check
pnpm test                 # 단위 테스트 (vitest)
pnpm test:coverage        # 커버리지 (lines/funcs/stmts 80%, branches 75%)
pnpm test:integration     # 실제 PostgreSQL 기반 통합 테스트
pnpm test:e2e             # Playwright E2E (dev :3000)
pnpm test:e2e:prod        # production 빌드(:3100) 기반 E2E
pnpm db:studio            # Prisma Studio
pnpm db:down              # docker compose down (볼륨 보존)
```

## 프로젝트 메모

- **PII**: `User.phone`/`User.birthDate`는 AES-256-GCM(`BYTEA`)로 저장. 읽기는 `lib/prisma/extends.ts` 자동 복호화, 쓰기는 `encryptUserPiiInput`, 응답은 `lib/pii/mask.ts`로 마스킹. `$queryRaw`는 extension을 우회하므로 `decryptUserPiiField`를 직접 호출. 상세: [`docs/security/pii-encryption.md`](docs/security/pii-encryption.md).
- **마이그레이션**: 로컬 `prisma migrate dev`, 운영 `prisma migrate deploy`. `db push` 금지. destructive ALTER는 `COUNT(*) > 0` guard 동반. `pnpm check:migrations`로 `CREATE INDEX CONCURRENTLY` 회귀 차단.
- **E2E soft-404**: 공고 `notFound()`는 Next 14.2 SSR에서 HTTP 200을 반환(프레임워크 한계). 죽은 URL은 `robots: noindex`로 색인 차단. 상세: [`docs/requirements/CANDID-051-spec.md`](docs/requirements/CANDID-051-spec.md).

## 디렉토리

```
app/        # Next.js App Router (페이지 · Route Handlers)
lib/        # 도메인 로직 (auth · prisma · pii · admin · errors ...)
prisma/     # schema.prisma · migrations · seed
tests/      # 단위 · 통합 테스트
e2e/        # Playwright E2E
docs/       # 요구사항 · 보안 · 아키텍처 문서
```

## 요구사항

비즈니스 요구사항은 `docs/sample-requirement.md`(PRD)에 정의되어 있습니다.

## 라이선스

미정 (회사 정책에 따라 LICENSE 추가 필요).
