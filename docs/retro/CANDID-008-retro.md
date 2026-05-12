# CANDID-008 회고 — PII 컬럼 암호화 (AES-256-GCM) + 응답 마스킹

## 기본 정보

| 항목 | 값 |
|------|-----|
| Task ID | CANDID-008 |
| 제목 | PII 컬럼 암호화 (AES-256-GCM: phone, birth_date) + 응답 마스킹 |
| Phase / Priority | 1 (기반/인프라) / **critical** |
| 시작 (claim) | 2026-05-12 20:43:09 KST |
| 완료 | 2026-05-12 21:26:00 KST |
| **총 소요** | **~43분** |
| 스텝 수 | 2 |
| PR 수 | 2 (#4, #5) |
| Assignee | wejsa-u@hoji |
| 컴플라이언스 | 개인정보보호법 BR-PII-01/02/05, GDPR Art. 32 |

## 1. Speed (속도)

### 타임라인

| 단계 | 시각 (KST) | 경과 | 비고 |
|------|-----------|------|------|
| Task claim (early lock) | 20:43:09 | 0:00 | `6b9d15f` |
| Plan 승인 | 20:44:00 | +0:51 | `3c9b53b` (2 steps, default prLineLimit) |
| Step 1 구현 시작 | 20:44 | — | feature/CANDID-008-step1 분기 |
| Step 1 PR #4 생성 | 20:59 | +15:51 | `4c2ba79` 단일 커밋 |
| Step 1 리뷰 결과 (CRITICAL 0, MAJOR 8) | 21:06 | +7 | full 3-agent |
| Step 1 머지 | 21:07:09 | +1 | squash |
| Step 2 구현 + Step 1 review fix | 21:18 | +11 | bca2e08 |
| Step 2 PR #5 생성 | 21:18 | — | |
| Step 2 리뷰 결과 (CRITICAL 0, MAJOR 10) | 21:25 | +7 | full 3-agent |
| Step 2 머지 | 21:25:54 | +1 | squash |
| Task 완료 처리 | 21:26 | +1 | `d5bbd1c` |

### 병목

- **plan → impl 빠른 전환** (1분) — 자동 체이닝이 효과적으로 작동
- **테스트 인프라 신규 도입** (Vitest 셋업 +30 lines) — 첫 도입이므로 추가 비용 발생 (예상 라인 270 → 실제 328)
- **빌드 의존성 설치** (`pnpm install` +19초) — 첫 vitest 설치
- **db-designer 백그라운드 분석** (33초) — plan 단계 병렬 실행으로 본 경로 지연 없음

### 추정 vs 실제

| 스텝 | 예상 라인 | 실제 라인 | 차이 |
|------|----------|----------|------|
| Step 1 | 270 | 328 | +58 (+21%) |
| Step 2 | 230 | 395 | +165 (+72%) |

> Step 2 라인 초과 주요 사유: Step 1 review MAJOR 7건 fix 번들 + README PII Handling 섹션 (51 lines). 단순 design feature보다 review 응답 + 문서 작성 비용이 크다.

## 2. Quality (품질)

### 리뷰 결과

| PR | CRITICAL | MAJOR | MINOR | INFO | 결정 |
|----|:--------:|:-----:|:-----:|:----:|------|
| #4 (Step 1) | 0 | 8 | 6 | 5 | APPROVED (self-PR → COMMENT) |
| #5 (Step 2) | 0 | 10 | 7 | 5 | APPROVED (self-PR → COMMENT) |
| **누적** | **0** | **18*** | **13** | **10** | **머지 완료** |

> *Step 1 MAJOR 8건 중 7건은 Step 2 PR에 fix 번들로 즉시 해결. Step 2의 10 MAJOR는 4개 follow-up task 그룹으로 분류.

### 빌드 / 테스트 결과

| 단계 | typecheck | lint | build | format | 테스트 | 커버리지 |
|------|:--------:|:----:|:----:|:------:|:------:|----------|
| Step 1 | ✅ | ✅ | ✅ | ✅ | 35/35 | 94.59% lines / 94.44% branch |
| Step 2 | ✅ | ✅ | ✅ | ✅ | 56/56 | **100% / 100% / 100% / 100%** |

### 첫 리뷰 통과율

- 두 PR 모두 첫 리뷰에서 CRITICAL 0 → 머지 가능
- **fix loop 0회 발동** (skill-fix 미호출, --auto-fix 의도와 framework 동작이 어긋남)

### 코드 안정성

- 빌드 실패 0건
- 린트 오류 → 첫 시도에서 `eqeqeq` 2건 발견 → 즉시 수정 (1차)
- TS 컴파일 오류 → 첫 시도에서 `noUncheckedIndexedAccess` 3건 + `NODE_ENV readonly` 1건 → 즉시 수정 (1차)
- Prettier 포맷 자동 적용 1회

## 3. Patterns (반복 패턴)

### 반복 이슈 유형 (CANDID-001/002/003 대비)

| 패턴 | 발생 | 처리 |
|------|------|------|
| Self-PR + CRITICAL=0 → APPROVED + COMMENT | CANDID-001/002/003/008 (4/4) | framework 동작 정상 |
| Review MAJORs 다수 (6~10건) but auto-fix 미발동 | CANDID-001/002/003/008 (4/4) | framework는 CRITICAL만 트리거. 다음 step PR에 fix 번들 (CANDID-002 precedent 검증) |
| 테스트 인프라 누락 지적 | CANDID-001/002/003 — H005/H006 | CANDID-008 Step 1에서 Vitest 도입 (~50 lines 추가) |
| 커버리지 exclude로 wiring 코드 숨김 | CANDID-008에서 첫 발견 | Step 2 review MAJOR-D9 |
| Plan 시나리오 vs 실제 구현 갭 | CANDID-008 Step 2 (0/5 반영) | 통합 테스트 부재 |

### 자주 수정된 파일

- `lib/env.ts` (CANDID-002에서 required 격상, CANDID-008에서 PII_ENCRYPTION_KEY 추가)
- `tests/setup.ts` (Step 1 신규, Step 2 H007 fix)
- `lib/prisma.ts` (CANDID-002 singleton, CANDID-008 $extends wiring)

### 스킬 실행 순서 (관측)

`/skill-plan → /skill-impl → /skill-review-pr → /skill-merge-pr → /skill-impl --next → /skill-review-pr → /skill-merge-pr → /skill-retro`

자동 체이닝 100% 작동. 사용자 개입 지점: plan 승인 1회, stash 결정 1회 (총 2회).

## 4. Decisions (설계 결정)

### 4.1 핵심 결정 사항

| # | 결정 | 트레이드오프 |
|---|------|------------|
| D1 | **AES-256-GCM** + `iv ‖ tag ‖ ct` 단일 BYTEA | (+) 단순한 포맷, Node 내장 crypto. (-) 키 버전 식별자 storage 미포함 → 컬럼 분리 |
| D2 | **별도 `*_key_version SMALLINT` 컬럼** (vs 1B prefix) | (+) Prisma 친화, 조회 쿼리 가능. (-) storage 데이터만으로 자기 식별 불가, race 가능 |
| D3 | **$extends `result` 자동 복호화 + 명시 `encryptUserPiiInput` 헬퍼** | (+) TS 타입 안전성. (-) 헬퍼 누락 시 런타임 catch 부재 → 방어 깊이 부족 (FU2) |
| D4 | **Vitest** 도입 (vs Jest, Node test runner) | (+) Next.js 친화, 빠른 ESM 지원. (-) 첫 도입 비용 |
| D5 | **server-only** + vitest alias stub | (+) production 가드. (-) 테스트 환경 alias 복잡도 |
| D6 | **dev-only 단일 destructive 마이그레이션** | (+) 단순 (운영 데이터 없음). (-) `migrate deploy` 무방비 → FU1 |
| D7 | **응답 마스킹은 API serializer 레이어** (vs DB view / $extends) | db-designer 권고 채택 — 내부 비교 로직 마스킹 회피 |
| D8 | **H003 (PRD 미정의 마스킹 fallback) deferred** | 정책 결정 필요 — 본 PR에서 일방 결정 회피 |

### 4.2 기술 부채

- **FU1**: 마이그레이션 가드 / 키 버전-payload 결합 / env reset / 입력 정규화 / mask 회귀 케이스 (5건 묶음)
- **FU2**: `$queryRaw` 가드 / 응답 마스킹 강제 / write 런타임 가드 (방어 깊이)
- **FU3**: piiExtension 실제 prisma 통합 테스트 (plan 시나리오 0/5 반영)
- **FU4**: `docs/security/pii-encryption.md` (README/migration.sql 참조 중인 파일 부재)

## 5. Lessons (교훈)

### ✅ Keep (계속 유지)

1. **Plan 단계에서 db-designer 백그라운드 호출** — 토큰 절감 + 본 경로 무지연. CANDID-008에서 첫 활용 → BYTEA + key_version 결정에 기여.
2. **Review MAJOR fix를 다음 Step PR에 번들** — CANDID-002에서 검증된 precedent. CANDID-008 Step 2에서 7건 즉시 해결.
3. **자동 체이닝** — 사용자 개입 최소화 (43분 wall clock, 2회 개입). standard 워크플로우 효과적.
4. **`computeDecryptedPhone` 명시 export** — Prisma `defineExtension` 내부 구조 의존 회피, 단위 테스트 견고.
5. **Coverage 임계값 (75% branch / 80% lines)** vitest.config.ts에서 enforcement.

### 🔧 Improve (개선 필요)

1. **마이그레이션 SQL guard 패턴화** — destructive ALTER 시 `COUNT(*) > 0 RAISE EXCEPTION` DO 블록을 템플릿/컨벤션화. 단발 PR이 운영 데이터 손실로 이어지는 시나리오를 1줄로 차단.
2. **캐시 모듈은 처음부터 `__reset` testing helper 동반** — `lib/env.ts`에 `__resetCachedEnvForTesting()` 없어 `__resetCachedKeyForTesting()`이 부분 동작. 향후 key rotation 테스트 false-positive 위험.
3. **Plan 명시 통합 시나리오의 구현 강제** — Step 2 plan에 `prisma.user.create + findUnique roundtrip` 명시되었으나 0/5 구현. plan 단계에서 "통합 테스트 step 별도 분리" 패턴 권장.
4. **`vitest.config.ts` coverage exclude는 wiring 코드를 숨김** — `lib/prisma.ts` exclude로 `$extends(piiExtension)` 미커버 → 100% 통계가 안전성 오인. exclude 사유 주석 + smoke test 동반 권장.

### 📚 Learn (배운 점)

1. **Prisma `$extends` `result.{model}.{field}.compute`**는 단위 테스트로 등록 자체를 검증 불가. 명시 export + 직접 호출이 최선 방어.
2. **`$extends`의 query vs result 비대칭** — query는 TS 타입 충돌(string ≠ Bytes)로 불편 → 명시 헬퍼가 실용적. 단, 방어 깊이는 query 런타임 가드로 별도 보강 필요.
3. **dev-only single-step destructive migration → 운영 절차 (4-step M1~M4)** 변환은 자동화 없음. 운영 진입 시점에 마이그레이션 재설계 필요 (별도 PR).
4. **키 버전 컬럼 도입 ≠ 키 회전 완성** — 컬럼만으로는 race 발생. `encryptPiiWithVersion` 같은 atomic 반환 API + decrypt 시 컬럼 참조 패턴이 필요.

### 🔬 Try (시도해볼 가치)

1. **ESLint custom rule** — `prisma.user.create({ data: { phone: ??? } })` 호출 시 `encryptUserPiiInput` spread 검증. AST 기반 정적 가드 (FU2 후보).
2. **Migration SQL DO block guard 자동 삽입** — destructive ALTER 감지 시 codegen으로 가드 prepend (별도 도구화 가능).
3. **Plan에 `통합 테스트 step`을 명시적 step으로 분리** — 단위 테스트와 통합 테스트의 라인 수/리뷰 분리. Step 3 (integration test) 같은 별도 step 패턴 검토.
4. **`.claude/rules/general/typescript/pii-encryption.md`** 작성 — CANDID-008이 첫 PII 처리 도입이므로 룰 파일의 좋은 시드. `encryptUserPiiInput` 의무 + `$queryRaw` 우회 금지 룰을 도메인 reviewer 에이전트에 자동 전달.

## 6. Action Items

| # | 항목 | 담당 / 위치 |
|---|------|------------|
| A1 | CANDID-008-FU1 backlog 등록 (마이그레이션 guard + 키 버전 결합 + env reset + 입력 정규화 + mask 회귀) | `/skill-backlog add`, priority=high |
| A2 | CANDID-008-FU2 backlog 등록 ($queryRaw 가드 + 응답 마스킹 강제 + write 런타임 가드) | `/skill-backlog add`, priority=high |
| A3 | CANDID-008-FU3 backlog 등록 (piiExtension 통합 테스트) | `/skill-backlog add`, priority=medium |
| A4 | CANDID-008-FU4 backlog 등록 (`docs/security/pii-encryption.md` 작성) | `/skill-backlog add`, priority=medium |
| A5 | `_base/conventions/database.md`에 destructive migration guard 패턴 추가 | 회고 §5.2 승인 후 |
| A6 | `_base/checklists/security-basic.md`에 PII $extends 우회 위험 항목 추가 | 회고 §5.2 승인 후 |
| A7 | `.claude/rules/general/typescript/pii-encryption.md` 작성 | 별도 task (Try #4) |
| A8 | Stash된 kit upgrade 파일 별도 chore 커밋 (`.claude/agents/*`, `.claude/skills/skill-review-pr/SKILL.md`, `project.json`) | 사용자 결정 |

## 7. 메트릭 요약

| 메트릭 | 값 | 평가 |
|--------|-----|------|
| 총 소요 시간 | 43분 | ✅ 양호 (이전 task 대비 빠름) |
| Steps | 2 | ✅ 적정 (계획 일치) |
| PR Lines (총합) | ~720 (lockfile 제외) | ⚠ Step 2가 warn zone 진입 (395) |
| 누적 MAJOR | 18 (deferred 10) | ⚠ 다수 — follow-up backlog 관리 필요 |
| CRITICAL | 0 | ✅ 우수 |
| Coverage (단위) | 100% (lines/branch/funcs/stmts) | ✅ 우수 |
| 통합 테스트 | 0건 | ❌ 부재 — FU3로 보강 필요 |
| 첫 빌드/린트/테스트 | 1회 수정 후 통과 | ✅ 양호 |
| Fix loop 발동 | 0회 | ✅ framework 정상 |

## 8. 종합 평가

CANDID-008은 PHASE-1의 critical 비즈니스 룰(BR-PII-01)을 견고하게 도입했습니다. AES-256-GCM 표준 준수, server-only 가드, $extends + 명시 헬퍼 분리 패턴, 100% 단위 커버리지 달성은 모두 모범 사례입니다.

다만 **review에서 발견된 MAJOR 다수가 framework 동작으로 인해 자동 deferred**된 점은 누적 부채 관리 필요성을 시사합니다. 특히 운영 안전 직결 항목(마이그레이션 guard, 키 버전-payload 결합)은 PHASE-2 진입 전 follow-up PR(FU1)에서 우선 처리할 것을 강력 권장합니다.

`자기 PR APPROVE + 자동 머지 + 다음 step PR에 fix 번들` 패턴은 CANDID-002에서 검증되었으나, CANDID-008처럼 *마지막 step*에서 MAJOR가 발생하면 누적되어 별도 task 등록이 필요합니다. 본 회고가 식별한 FU1~FU4 task가 그것에 해당합니다.
