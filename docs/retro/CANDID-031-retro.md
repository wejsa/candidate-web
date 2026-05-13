# CANDID-031 회고 — PII 방어 깊이 강화 (CANDID-008 FU2)

## 기본 정보

| 항목 | 값 |
|------|-----|
| Task ID | CANDID-031 |
| 제목 | CANDID-008 FU2: PII 방어 깊이 강화 ($queryRaw 가드 + 응답 마스킹 강제 + write 런타임 가드) |
| Phase / Priority | 1 (기반/인프라) / high |
| 시작 (claim) | 2026-05-13 14:16:55 |
| 완료 | 2026-05-13 14:54:34 |
| **총 소요** | **~37분 39초** |
| 스텝 수 | 3 (D6 + D7 + D8) |
| PR 수 | 3 (#7, #8, #9) |
| Assignee | jaese@hoji |
| 컴플라이언스 | 개인정보보호법 BR-PII-01 (defense-in-depth), GDPR Art. 32 |

## 1. Speed (속도)

### 타임라인

| 단계 | 시각 (UTC) | 경과 | 비고 |
|------|-----------|------|------|
| Task claim (early lock) | 14:16:55 | 0:00 | `60c4151 chore: claim CANDID-031` |
| Plan 승인 | 14:18:30 | +1:35 | `63d58f4 plan approved (3 step split — D6+D7+D8)` |
| Step 1 (D6) PR #7 생성 | 14:25:55 | +7:25 | `4a715b0` — ESLint + CLAUDE.md |
| Step 1 머지 | 14:30:36 | +4:41 | full 3-agent review, CRITICAL 0 |
| Step 2 (D7) PR #8 생성 | 14:35:51 | +5:15 | `cfe0e3c` — zod userPublicSchema |
| Step 2 1차 review (CRITICAL 1) | ~14:36 | +1 | C001 InputSchema anchor |
| **skill-fix 1회차 자동 수정** | ~14:38 | +2 | `b4f1344` — type anchor + ZodError 안전망 + .strip + 테스트 3건 |
| Step 2 2차 review (CRITICAL 0) | ~14:43 | +5 | 모든 1차 이슈 해결 검증 |
| Step 2 머지 | 14:45:17 | +2 | |
| Step 3 (D8) PR #9 생성 | 14:50:57 | +5:40 | `ebb17e8` — query.user.* 가드 |
| Step 3 머지 | 14:54:20 | +3:23 | review CRITICAL 0 |
| Task 완료 처리 | 14:54:34 | +0:14 | `023169f` |

### 병목
- **Step 2 fix loop** — 1차 review에서 CRITICAL 1건(type anchor) 발견 → skill-fix 1회차 → 2차 review. 약 7분 추가 발생. 그러나 동시에 MAJOR/MINOR/INFO 다수도 함께 해결 → 단일 사이클 효율.
- **마지막 Step 머지 직전 backlog 동기화 충돌** — feature 브랜치와 develop의 backlog.json 버전 격차로 mid-step 충돌 1건 (자동 해결).

### 추정 vs 실제

| 스텝 | 예상 라인 | 실제 라인 | 차이 | 비고 |
|------|----------|----------|------|------|
| Step 1 (D6) | 50 | 30 | -20 (-40%) | ESLint config + docs 1줄 — 예상보다 단순 |
| Step 2 (D7) | 305 | 264 | -41 (-13%) | review fix 4건 번들 포함 (+48 LOC) |
| Step 3 (D8) | 175 | 171 | -4 (-2%) | 예상 정확 |
| **합계** | **530** | **465** | **-65 (-12%)** | 계획 추정이 견고했음 |

## 2. Quality (품질)

### 리뷰 결과

| PR | CRITICAL | MAJOR | MINOR | INFO | 결정 | 회차 |
|----|:--------:|:-----:|:-----:|:----:|------|:----:|
| #7 (Step 1 D6) | 0 | 2 | 3 | 4 | APPROVED (self-PR → COMMENT) | 1회 |
| #8 (Step 2 D7) | 1 | 4 | 2 | 4 | REQUEST_CHANGES → skill-fix → APPROVED | **2회** |
| #9 (Step 3 D8) | 0 | 2 | 3 | 9 | APPROVED (self-PR → COMMENT) | 1회 |
| **누적** | **1** | **8** | **8** | **17** | **머지 완료** | **1 fix loop** |

> CRITICAL 1건은 Step 2 PR #8에서 발견되어 skill-fix 1회차로 해결.
> MAJOR 8건은 모두 *알려진 한계 / follow-up*으로 분류되어 머지 차단 사유 아님.

### 빌드 / 테스트 결과

| 단계 | typecheck | lint | build | format | 테스트 | 신규 |
|------|:--------:|:----:|:----:|:------:|:------:|:----:|
| Step 1 | ✅ | ✅ | ✅ | ✅ | 81/81 | 0 신규 (정적 규칙) |
| Step 2 | ✅ | ✅ | ✅ | ✅ | 98/98 | **+17** |
| Step 2 (fix) | ✅ | ✅ | ✅ | ✅ | 98/98 | +3 보강 (Buffer 대칭 / 멱등성 / ZodError) |
| Step 3 | ✅ | ✅ | ✅ | ✅ | **112/112** | **+14** |
| **누적** | — | — | — | — | **112** | **+31** |

### 코드 안정성
- 빌드 실패 0건
- 린트 0건 (Step 1의 가드 추가 후에도 기존 코드는 raw query 사용 0건 → 자연 통과)
- 첫 시도 통과율 — 각 step 본 구현은 1회 빌드/테스트 통과 (Step 2의 fix 후 보강에서만 prettier 자동 포맷 1회)
- skill-fix 발동: **1회**

### 첫 리뷰 통과율
- 3 PR 중 2건은 첫 리뷰에서 CRITICAL 0
- Step 2만 1차 리뷰에서 CRITICAL 1건 발견 → 동일 PR에서 fix 적용 (브랜치 보존, --auto-fix 흐름)

## 3. Patterns (반복 패턴)

### 반복 이슈 유형 (이전 Task 대비)

| 패턴 | 발생 | 처리 |
|------|------|------|
| Self-PR + CRITICAL=0 → APPROVED+COMMENT | PR #7, #9 (2/3) | framework 동작 정상 |
| Review MAJOR 다수 but auto-fix 미발동 | PR #7, #9 모두 follow-up 분리 | precedent 부합 |
| **CRITICAL 1건 → skill-fix 1회차 즉시 해결** | **PR #8 신규** | --auto-fix 흐름 정상 작동, 같은 PR에서 MAJOR/MINOR 다수도 함께 번들 처리 |
| Plan-실제 라인 추정 견고 | 3/3 step 모두 -2~-13% 오차 | CANDID-008(+21~72%) 대비 크게 개선 — 따라할 Task |
| nested write Prisma 한계 | PR #9에서 첫 발견 | follow-up task 권장 |

### 자주 수정된 파일
- `lib/prisma/extends.ts` (CANDID-008 도입, CANDID-030 보강, **CANDID-031 D8 가드 추가**) — PII 패턴의 *중심 파일*. 3번째 Task 연속 수정 — 추후 분리 검토 가치
- `.eslintrc.json` (CANDID-001 도입, **CANDID-031에서 첫 보안 룰 추가**) — 향후 보안 룰의 확장점
- `CLAUDE.md` 보안 강제 사항 (CANDID-031에서 첫 갱신) — 정책 SSOT 진화

### 스킬 실행 순서 (관측)

`/skill-plan → /skill-impl(D6) → /skill-review-pr → /skill-merge-pr → /skill-impl --next(D7) → /skill-review-pr → **/skill-fix** → /skill-review-pr → /skill-merge-pr → /skill-impl --next(D8) → /skill-review-pr → /skill-merge-pr → 완료`

자동 체이닝 100% 작동. 사용자 개입 지점: plan 승인 1회, Task 선택 시 1회 (총 2회).

## 4. Decisions (설계 결정)

### 4.1 핵심 결정 사항

| # | 결정 | 트레이드오프 |
|---|------|------------|
| D1 | **3 step 분리 vs 단일 PR** | (+) 리뷰 부담 분산, 각 layer 독립 회귀 가드. (-) 머지 사이클 3회 — 본 Task에서 분리 선택, 결과적으로 적절 |
| D2 | **ESLint `no-restricted-syntax` 6 selector** ($queryRaw/Unsafe + $executeRaw/Unsafe × Call/Tagged) | (+) tagged template literal 누락 방지. (-) alias/computed property 우회 가능 — D8 런타임 가드가 보완 |
| D3 | **zod `.transform()` 단일 schema vs branded type** | (+) 단순, 강력한 마스킹 강제. (-) 단일 진입점 *강제 메커니즘*은 없음(convention/docblock 의존) — H002 잔존 |
| D4 | **`userPublicInputSchema` 기본 strip (fail-closed)** | (+) 신규 PII 컬럼 누설 차단 (passwordHash/keyVersion 자연 제거). (-) strict 모드는 정상 흐름 차단 위험 → strip 선택 |
| D5 | **`UserPublicInput` anchor를 InputSchema에 결합** (review fix C001) | (+) transform 추가 시에도 input contract 안정 — fix loop 1회로 즉시 개선 |
| D6 | **`toUserPublic` 자체 ZodError 안전망** (review fix H001) | (+) 전역 에러 핸들러 도입 전까지 PII 메시지 누설 차단 — 자체 방어선. (-) message 문자열 (커스텀 Error 클래스가 더 견고) — follow-up |
| D7 | **`assertUserPiiInputShape` named export** (L-003 적용) | (+) extension 내부 구조 의존 없이 단위 테스트. (-) — 트레이드오프 없음 |
| D8 | **`piiExtension.query.user` 5 op (create/createMany/update/updateMany/upsert) 가드** | (+) 모든 top-level user write 차단. (-) nested write (inverse-side) 미커버 — Prisma 후크 한계, follow-up |
| D9 | **`{ set: 'string' }` wrapper도 차단** | (+) Prisma update 우회 경로 차단. (-) `{ increment: ... }` 같은 비-set wrapper는 통과 (테스트 케이스 명시 부재) |

### 4.2 기술 부채 (follow-up task 권장)

| ID | 우선순위 | 항목 | 근거 |
|----|:--------:|------|------|
| FU2-A | 중 | nested write (inverse-side) 가드 — child 모델 query 후크 확장 | PR #9 도메인/보안 리뷰 MAJOR (동일 근본 원인) |
| FU2-B | 중 | `userPublicSchema` 단일 진입점 강제 메커니즘 (ESLint / nominal type) | PR #8 아키텍처 MAJOR (H003) |
| FU2-C | 중 | `.github/workflows/ci.yml` lint+test 게이트 | PR #7 테스트 MAJOR (H002) — D6 가드가 *실제* PR 차단으로 이어지려면 CI 필요 |
| FU2-D | 중 | ESLint `$queryRaw` 가드 회귀 메타 테스트 (vitest ESLint API) | PR #7 테스트 MAJOR (H001) — 정적 가드 자체의 회귀 차단 |
| FU2-E | 저 | `SerializationError` 커스텀 Error 클래스 (전역 에러 핸들러 연계) | PR #8 보안 MINOR |
| FU2-F | 저 | `PII_FIELDS` 상수화 (`assertUserPiiInputShape` 확장성) | PR #9 도메인 MINOR (M002) |

## 5. Lessons (교훈)

### ✅ Keep (계속 유지)

1. **Plan 단계의 추정 견고** — CANDID-008(+21~72% 오차) 대비 본 Task는 -2~-13% 오차로 크게 개선. 사유: review fix 번들을 estimatedLines에 사전 반영 + 각 step의 책임 경계 명확화.
2. **Step 1에서 가드 발동 fixture로 *수동* 검증 후 삭제** — 30 LOC PR로 깔끔. 단, 회귀 차단 메커니즘 부재는 follow-up (FU2-D)으로 분리.
3. **fail-closed `.strip()` 명시 호출** — zod 기본 동작에 의존하지 않고 의도를 코드로 표현. 향후 `.passthrough()`로 회귀 시 리뷰에서 명시적 변화 감지 가능.
4. **Review MAJOR fix 번들을 같은 PR에 즉시 적용** (Step 2 fix loop) — `--auto-fix` 흐름이 CRITICAL + 추가 MAJOR/MINOR/INFO 다수를 단일 사이클에서 처리. CANDID-008/CANDID-030의 "다음 step PR 번들" 패턴보다 빠르고 명확.
5. **`assertUserPiiInputShape` named export** (L-003 적용) — extension 내부 구조 의존 없이 단위 테스트. 14 케이스 / 분기 100% 커버.
6. **자동 체이닝 효율** — 38분 wall clock에서 사용자 개입 단 2회 (plan 승인 + Task 선택).

### 🔧 Improve (개선 필요)

1. **nested write (inverse-side relation) 한계 사전 인지 부족** — Prisma `query.{model}` 후크가 top-level 호출만 trigger한다는 점이 D8 계획 수립 시점에 미인식. domain reviewer가 발견 → follow-up으로 분리. **plan 단계 체크리스트에 "ORM extension hook coverage" 항목 추가** 권장.
2. **CI 워크플로 부재** (FU2-C) — D6 가드가 *실제* PR 차단을 위해서는 CI lint 게이트가 필수이지만 본 프로젝트는 `.github/workflows/` 자체가 부재. *정적 가드의 가치 = lint가 실행되는가*에 강하게 의존 — 우선순위 격상 검토.
3. **단일 schema 진입점 *강제* 메커니즘 부재** — D7은 `toUserPublic` 호출을 *convention/docblock*에만 의존. ESLint rule 또는 nominal type brand로 `Response.json(prismaUser)` 직접 호출을 차단하는 후속 강제가 필요.
4. **timezone label 일관성** — `date -u +"...+09:00"` 패턴은 UTC 값을 KST 라벨로 출력. backlog/completed timestamps에 부정확한 +09:00 prefix가 박힘. 사용자 시각 분석에 영향 없지만 SSOT 정확도 차원에서 `date +"...%:z"` 권장.

### 📚 Learn (배운 점)

1. **Prisma `query.{model}.{op}` 후크 = top-level write only** — `prisma.user.create`는 trigger하지만 `prisma.authProvider.create({ data: { user: { create: {...} } } })`는 미트리거. defense-in-depth 설계 시 *모든 모델*의 query 후크 또는 *result extension*(`needs` 기반) 측면에서 확장이 필요할 수 있음.
2. **zod transform schema의 `z.input<T>` 추론은 transform 전 입력 형태로 정확히 도출**되지만, *분리된 InputSchema가 있다면 거기에 anchor하는 것이 의도 명확*. C001 review가 이 패턴 차이를 정확히 짚었음.
3. **3-layer defense-in-depth** = 정적(ESLint) + 직렬화 진입점(zod DTO) + 런타임(extension query 후크). 각 layer는 독립 회귀 가드를 가져야 하며, 한 layer의 우회는 다음 layer가 차단하도록 책임 경계 명확화.
4. **AST selector의 표현력 한계** — `CallExpression[callee.property.name='X']`는 직접 access 패턴만 커버. alias/destructure/computed property는 LLM 리뷰 영역. MemberExpression 단위 광역 차단은 false positive 발생 → 책임 경계 분리가 합리적.

### 🔬 Try (시도해볼 가치)

1. **ESLint `no-restricted-syntax` 회귀 메타 테스트** — `vitest`에서 `ESLint.lintText()` 직접 호출하여 6 selector 발동 검증. 30 LOC로 회귀 차단 완성. FU2-D로 우선 진행 권장.
2. **`PII_FIELDS = ['phone', 'birthDate'] as const`** 상수화 — `assertUserPiiInputShape` + `userPublicInputSchema` + `encryptUserPiiInput`을 동일 SSOT에서 derive. 신규 PII 컬럼 추가 시 누락 차단.
3. **`PrismaUserPublic` branded type** — `prisma.user.findX` 결과를 nominal type으로 감싸 `Response.json` 직접 호출을 컴파일 타임에 차단. D7 단일 진입점 강제의 진정한 구현.
4. **CI 워크플로 도입** — `.github/workflows/ci.yml` 추가로 lint + typecheck + test + format-check를 PR 게이트화. 본 Task에서 도입한 모든 정적 가드의 실효성을 끌어올림. FU2-C.

## 6. Action Items

| # | 항목 | 담당 / 위치 |
|---|------|------------|
| A1 | CANDID-008 FU3(testcontainer 통합 테스트) backlog 진행 가능 — CANDID-032 (이미 등록됨) | `/skill-plan CANDID-032` |
| A2 | CANDID-008 FU4(`docs/security/pii-encryption.md`) backlog 진행 가능 — CANDID-033 (이미 등록됨) | `/skill-plan CANDID-033` |
| A3 | **신규**: nested write 가드 follow-up task 등록 | `/skill-backlog add` priority=medium |
| A4 | **신규**: `.github/workflows/ci.yml` 추가 task 등록 (FU2-C) | `/skill-backlog add` priority=medium |
| A5 | **신규**: ESLint 가드 회귀 메타 테스트 task 등록 (FU2-D) | `/skill-backlog add` priority=medium |
| A6 | **신규**: `userPublicSchema` 단일 진입점 강제 메커니즘 task (FU2-B) | `/skill-backlog add` priority=medium |
| A7 | `_base/checklists/security-basic.md`에 "ORM extension hook coverage (nested write 포함)" 체크 항목 추가 검토 | 사용자 승인 후 |
| A8 | `_base/conventions/database.md` 또는 별도 conventions에 "PII 컬럼은 SSOT 상수(`PII_FIELDS`)에서 derive" 패턴 추가 검토 | 사용자 승인 후 |

## 7. 메트릭 요약

| 메트릭 | 값 | 평가 |
|--------|-----|------|
| 총 소요 시간 | 38분 | ✅ 우수 (CANDID-008 43분, CANDID-030 ~50분 대비 빠름) |
| Steps | 3 | ✅ 적정 (defense-in-depth 자연스러운 분리) |
| PR Lines (총합) | 464 (29+264+171) | ✅ 양호 (각 step limit 이내) |
| 누적 MAJOR | 8 (deferred) | ⚠ 다수 — 모두 같은 근본 원인 / follow-up 분리 명확 |
| CRITICAL | 1 (해결) | ⚠ Step 2에서 발생, skill-fix 1회차로 해결 |
| 첫 빌드/린트/테스트 통과 | 3 step 모두 1회 통과 | ✅ 우수 |
| 신규 테스트 | +31 (D6 0 + D7 17 + D8 14) | ✅ 우수 (분기 커버리지 100%) |
| Coverage 영향 | 기존 유지 + 신규 모듈 95%+ | ✅ 양호 |
| 통합 테스트 | 0건 | ⚠ 부재 (CANDID-032가 담당하므로 적절히 분리) |
| Fix loop 발동 | 1회 (CRITICAL 1건) | ✅ 정상 작동 |

## 8. 종합 평가

CANDID-031은 CANDID-008 PII 암호화 도입의 *방어 깊이*(defense-in-depth) 3-layer를 완성한 후속 작업입니다. 38분 wall clock에서 3 PR, 31 신규 테스트, fix loop 1회차로 깔끔하게 종결되었습니다.

**핵심 성과**:
- **3-layer 패턴 정립** — D6(정적) / D7(직렬화) / D8(런타임)의 책임 경계가 명확하여 향후 보안 도메인 작업의 reference 패턴으로 활용 가능
- **계획 추정 정확도 향상** — CANDID-008의 큰 오차(+21~72%)를 -2~-13%로 크게 개선. 사유: review fix 비용 사전 반영 + step 책임 단순화
- **첫 fix loop 실전 검증** — Step 2 CRITICAL 1건을 skill-fix 1회차에서 *동일 PR 내*에 해결. CANDID-008의 "다음 step PR 번들" 패턴보다 빠른 사이클

**잔존 부채 명확화** — MAJOR 8건은 모두 *알려진 한계*로 follow-up task(FU2-A~F)로 분리됨. 머지 차단 사유 없이 후속 작업으로 우아하게 이관.

**경계 인식 강화 권장** — `Prisma query 후크의 nested write 한계`는 plan 단계에서 미인지 → domain reviewer가 발견. 차후 ORM extension 패턴 작업 시 *호출 표면 매트릭스*(top-level / nested / raw)를 plan 체크리스트에 포함하면 유사 한계 사전 가시화 가능합니다.
