# CANDID-034 회고 (CANDID-005 FU1)

> 회고 작성: 2026-05-17 / skill-retro v1
> Spec / Origin: `docs/retro/CANDID-005-retro.md` (§3 A1 / §2.4 D3 FU1 결정)

## 1. 기본 정보

| 항목 | 값 |
|------|-----|
| Task ID | CANDID-034 |
| 제목 | CANDID-005 FU1: Application PII snapshot AES-256-GCM extension wiring + 단위 테스트 |
| Phase | 1 (기반/인프라) |
| Priority | high |
| Type | feature |
| 시작 시각 | 2026-05-17T22:43:00+09:00 (claim) |
| 완료 시각 | 2026-05-17T23:39:17+09:00 |
| **총 소요** | **~56분** (claim → 머지) |
| 스텝 수 | 4 |
| PR 수 | 4 (#14, #15, #16, #17) |
| 전체 LOC | +1,282 / -26 |
| 신규 unit tests | +87 (vitest 112 → 199 passed) |
| fix loop | **0회** (CRITICAL 0건) |
| 회귀 | **0건** |

### 1.1 스텝별 요약

| Step | PR | 머지 시각 | LOC (+/-) | 추정 vs 실제 | 리뷰 결과 |
|:---:|:---:|------|------|------|------|
| 1 (schema rename) | #14 | 23:07:11 | 49 / 20 | 40 vs 49 (**+22%**) | CRITICAL 0 / MAJOR 1 / MINOR 4 / INFO 9 |
| 2 (SSOT + 헬퍼) | #15 | 23:19:44 | 511 / 0 | 380 vs 511 (**+35%**) | CRITICAL 0 / MAJOR 2 / MINOR 4 / INFO 6 |
| 3 (piiExtension wiring) | #16 | 23:29:29 | 291 / 3 | 220 vs 291 (**+32%**) | CRITICAL 0 / MAJOR 1 / MINOR 3 / INFO 12 |
| 4 (mask + serializer) | #17 | 23:39:17 | 431 / 3 | 480 vs 431 (**-10%**) | CRITICAL 0 / MAJOR 0 / MINOR 5 / INFO 16 |

## 2. 5축 분석

### 2.1 Speed (속도)

| 구간 | 추정 | 실제 |
|------|------|------|
| skill-plan (Task 선택 + db-designer + 4-step 분리) | 10~15분 | ~10분 |
| Step 1 (impl + review + merge) | 10~15분 | ~24분 |
| Step 2 (impl + review + merge) | 15~20분 | ~12분 |
| Step 3 (impl + review + merge) | 10~15분 | ~10분 |
| Step 4 (impl + review + merge) | 15~20분 | ~9분 |
| **합계** | 60~85분 | **~56분** (추정 안쪽) |

**병목 분석**:
- Step 1이 가장 길었음 (~24분) — 첫 step에서 prisma format/validate/generate/typecheck/lint/test/build 풀 검증 사이클 첫 실행 + 마이그레이션 SQL 작성 + L-001 guard 적용 부담 집중
- Step 2~4는 동일한 검증 사이클을 이미 통과한 상태에서 짧게 회전 (~10분/step)
- fix loop 0회로 사이클 매우 깨끗 — review-pr 결과가 모두 첫 통과(self-COMMENT) → merge 즉시 진행

### 2.2 Quality (품질)

| 지표 | 값 | 비고 |
|------|-----|------|
| CRITICAL 이슈 | **0** | 4 PR 통합 0건 — fix loop 0회 |
| MAJOR 이슈 | 4 (1+2+1+0) | PR #17 0건 — 가장 깨끗 |
| MINOR | 16 (4+4+3+5) | 모두 follow-up 위임 |
| INFO | 43 (9+6+12+16) | — |
| 첫 리뷰 통과 | 4/4 | 모두 self-COMMENT mode (자기 PR), CRITICAL 미발견 |
| 라인 추정 정확도 | **+22% / +35% / +32% / -10%** | Step 1~3 +20% 이상, Step 4만 -10% |
| 라인 수 vs limit | Step 1 49/100, Step 2 511/450 (강력경고), Step 3 291/280 (강력경고), Step 4 431/550 | Step 2/3가 강력 경고 범위 진입 |
| 빌드/테스트 회귀 | 0 | vitest 112 → 199 passed, 기존 테스트 0건 실패 |

**품질 점수 (정성 평가): A** — CRITICAL 0건, fix loop 0회, MAJOR 4건 모두 후속 위임 또는 다음 step에서 자체 보강. **PR #15 MAJOR 2건이 PR #16에서 후속 보강**된 *in-task self-correction* 패턴 — fix loop 없이 자연스러운 회수 사이클.

### 2.3 Patterns (패턴)

#### 반복된 좋은 패턴 (Keep)

1. **CANDID-008 패턴 100% 미러**: User wiring (CANDID-008/030/031) → Application wiring 평행 구조 일관 — encryptUserPiiInput ↔ encryptApplicationPiiSnapshotInput / assertUserPiiInputShape ↔ assertApplicationPiiInputShape / toUserPublic ↔ toApplicationPublic / piiExtension result.user ↔ result.application / piiExtension query.user ↔ query.application. 5개 영역 모두 명명/구조 정합.
2. **L-013/L-014/L-015 적용 검증**: CANDID-005에서 처음 추출된 학습이 본 task에서 *실제 코드 패턴*으로 반영 — schema rename 안전성(L-001 guard), SSOT 도입(L-006), nested write 한계 명시(L-007).
3. **schema 변경 없는 wiring task** 첫 사례 — Step 1만 schema 1줄 수정(rename), Step 2~4 모두 lib/* + tests/* 변경. wiring 패턴 표준화 가능.
4. **L-006 3-layer defense 완성 패턴**: 정적(D6 ESLint) → 런타임(Step 3 piiExtension) → 직렬화(Step 4 toApplicationPublic) 3 layer를 *분리 PR*로 도입. layer 간 의존 명확, 회귀 안전망 다중.

#### 새로 등장한 패턴 (Learn)

1. **In-task self-correction (신규 — L-019 후보)**: PR #15 review MAJOR H001/H002(birthDateSnapshot round-trip + email 경계)를 **PR #16에서 자체 보강** — skill-fix 호출 없이 다음 step PR에 보강 코드 자연 포함. 동일 파일 영역(tests/lib/prisma/extends.test.ts)이 다음 step에서도 수정되므로 가능. fix loop보다 빠른 회수 사이클.
2. **PII SSOT 도입 시점의 트레이드오프 (신규 — L-020 후보)**: 5쌍 명시 분기(`encryptApplicationPiiSnapshotInput` 60줄) vs `Record<Field, NormalizeFn>` 매핑 테이블 + 단일 루프 리팩토링. 필드별 normalize 함수가 다르면 (name/email/address/phone/birthDate) derive 불가 — 명시 분기 채택했으나 매핑 테이블 리팩토링은 향후 신규 PII 필드 추가 시 비용 절감.
3. **Step 0(선택적 schema rename)을 본 FU1 4-step에 통합**: D2 결정으로 rename Step을 별도 FU3 위임 대신 Step 1로 통합 — schema rename 직후 wiring이 더 직관적. dev 환경 비어있음 가정 + L-001 guard로 안전.

#### 자주 수정된 파일

- `lib/prisma/extends.ts`: Step 2, Step 3 모두 수정 (총 +300 LOC) — User wiring 6회 + Application wiring 2회 누적 8회 변경.
- `tests/lib/prisma/extends.test.ts`: Step 2, Step 3에서 누적 +457 LOC, 55 신규 테스트 (37 + 18). 향후 split 검토 가치.
- `lib/pii/serializer.ts` / `tests/lib/pii/serializer.test.ts`: Step 4에서 +272 LOC, 11 신규 테스트.

#### 라인 추정 정확도 (L-010 핵심 회고 항목)

| Step | 추정 | 실제 | 오차 | 원인 |
|:---:|---:|---:|---:|------|
| 1 | 40 | 49 | **+22%** | prisma format 자동 정렬(컬럼 spacing) 미반영 + migration.sql 주석 보강 |
| 2 | 380 | 511 | **+35%** | 5쌍 명시 분기(60줄) + assertApplicationPiiInputShape SSOT 루프 + 단위 테스트 보강 |
| 3 | 220 | 291 | **+32%** | 5개 compute + piiExtension 객체 통합 + L-007 docstring 회귀 가드 |
| 4 | 480 | 431 | -10% | mask 함수 단순 + serializer User 패턴 미러로 효율적 |

→ **Step 1~3 모두 +20% 이상 초과** — 단순 *review fix buffer 추가*(L-010 기존 정의)만으로 부족. 핵심 누락: ① SSOT derive 불가 시 명시 분기 라인 비대화 ② 단위 테스트가 본문 LOC와 비슷 비율로 증가 (User 패턴 1:1.4 → Application 패턴 동일) ③ prisma format 자동 정렬 시 schema.prisma spacing 변동 (예측 어려움).

### 2.4 Decisions (의사결정)

| # | 결정 | 근거 | 결과 |
|---|------|------|------|
| D1 | PII SSOT (lib/pii/fields.ts) 신설 | conventions database.md L155+ 정합 + 신규 컬럼 추가 비용 ↓ | ✅ 채택 (Step 2) |
| D2 | Step 0 schema rename을 본 FU1 4-step에 통합 | dev 환경 비어있음 + L-001 guard로 안전 | ✅ 채택 (Step 1) |
| D3 | maskName/maskEmail/maskAddress 3건 모두 본 FU1 | serializer 완결성 (3 layer defense 의도) | ✅ 채택 (Step 4) |
| D4 | 통합 테스트는 CANDID-005-FU2 위임 | CANDID-008 패턴 일관 (CANDID-032 위임) | ✅ 적합 (FU2 백로그 등록 권고) |
| D5 | piiExtension User+Application 단일 객체 통합 (분리 X) | `prisma.$extends(piiExtension)` 1회 호출 깔끔 | ✅ 적합 (단, 3+ 모델 확장 시 `composePiiExtensions([...])` 팩토리 고려) |
| D6 | `decryptApplicationPiiSnapshotField`는 `decryptUserPiiField` alias | 함수 본문 동일하지만 호출 의도 명시 가치 | ✅ 적합 (verbose하나 가독성 ↑) |
| D7 | 5쌍 명시 분기 (vs 매핑 테이블 + 단일 루프) | 필드별 normalize 함수 차이로 derive 불가 | ⚠️ 채택 (60줄 — 매핑 테이블 리팩토링 follow-up 권고) |

**기술 부채 (후속 task로 위임됨)**:
- M001 [Step 3 review]: 5개 compute에 `// TODO(키회전)` 주석 — v2 키 회전 도입 시 분기 로직 추가 위치
- M002 [Step 3 review]: piiExtension 구조 회귀 가드 간접성 — CANDID-005-FU2 통합 테스트로 보완
- H001 [Step 3 review, security]: L-007 nested write 한계 — CANDID-005-FU2 통합 테스트로 회귀 차단
- M001 [Step 4 review, domain]: `currentStage`/`result` `z.string()` 단순 → enum 강화
- M002/M003 [Step 4 review, security]: maskName 1글자 노출 + maskEmail local 1자 노출 정책 검토
- M004 [Step 4 review, test]: surrogate pair / 4-byte 이모지 명시 케이스
- M005 [Step 4 review, test]: applicationPublicSchema 필수 필드별 분리 reject 케이스

### 2.5 Lessons (교훈)

#### Keep (계속하기)

- **CANDID-008 패턴 미러**: 새 wiring task 진입 시 항상 *기존 User wiring 코드*를 1차 참조 → 평행 구조 일관성 확보. Application 외 추가 모델 도입 시에도 적용.
- **L-006 3-layer defense 분리 PR 도입**: 정적 → 런타임 → 직렬화 layer를 *PR 단위로 분리* → review 시점에 각 layer 책임 명확, 회귀 안전망 다층.
- **schema-only 변경 자동 검증**: prisma format → validate → generate → typecheck → vitest 회귀 0건 체인 — Step 1에서 빌드 안전망 검증 완료 후 wiring 진입.
- **lockedFiles 동적 갱신**: 머지된 파일 자동 unlock + 다음 step 파일 등록 — 4 step 동안 충돌 0건.

#### Improve (개선하기)

- **L-010 라인 추정 보정 — 신규 노트 추가 필요**: 기존 정의("review fix buffer 사전 반영")만으로 4 step 중 3 step에서 +20%+ 오차. 추가 보정 항목:
  - SSOT derive 불가 시 *5쌍 명시 분기 → 60줄 추정 추가* (필드 수 × 12줄)
  - 단위 테스트 LOC = 본문 LOC × 1.2~1.4 비율 (User wiring 패턴에서 검증)
  - prisma format 자동 spacing 정렬 시 schema.prisma +20% 추가 (예측 어려운 변동)
- **PR description의 추정 메타 보존**: 본 task는 PR description에 plan 추정 LOC를 명시 → 실측 대비 격차 추적 가능. 향후 모든 task에 동일 적용 권고.
- **단위 테스트 vs 통합 테스트 위임 정책 명문화**: 본 task에서 CANDID-008 패턴(통합은 FU 위임)을 자연스럽게 따랐으나, plan 문서에 *명시적 결정 항목*으로 두는 게 일관성 ↑.

#### Learn (배우기)

- **In-task self-correction 패턴**: 동일 파일 영역이 다음 step에서도 수정될 때, 직전 step review MAJOR를 *skill-fix 없이* 다음 step PR에 보강. fix loop보다 빠른 회수, review-fix-review 1회 사이클 절약. 단, 동일 step PR이 머지된 *후*에만 가능 — 같은 step PR을 *수정 후 재푸시*하는 amend가 아님.
- **5쌍 명시 분기의 라인 비대화**: 5필드 × 12줄 = 60줄 — Step 2 LOC 폭증 핵심 원인. SSOT 도입 가치는 *런타임 가드 + serializer strip*에서 발휘되지만, encrypt 헬퍼는 필드별 normalize 함수 차이로 derive 불가 → 매핑 테이블 + 단일 루프 리팩토링은 별도 가치 결정 필요.
- **piiExtension 단일 객체 통합 vs 분리**: 본 task는 User+Application 통합 채택 (단일 `$extends(piiExtension)`). 3+ 모델 진입 시 `composePiiExtensions([user, app, ...])` 팩토리로 분리하는 변곡점이 어디인지 추후 판단 필요.
- **L-006 3-layer defense 완성 검증**: User → Application 평행 구조 완성 — 두 모델 모두 *정적 + 런타임 + 직렬화* 3 layer 보호. 신규 PII 모델 추가 시 동일 3-step 분리(SSOT+헬퍼 → piiExtension → serializer) 적용 권고.

#### Try (시도해보기)

- **`Record<Field, NormalizeFn>` 매핑 테이블 + 단일 루프 리팩토링**: 다음 wiring task에서 시도 가능. 기존 encryptApplicationPiiSnapshotInput의 5쌍 분기를 단일 루프로 변경하여 신규 필드 추가 비용 절감.
- **L-010 보정 모델 v2 적용**: 다음 plan에서 위 3개 항목(SSOT 5쌍 분기 +60 / 테스트 1:1.3 / format +20%) 명시적 반영 → 라인 추정 정확도 ±15% 이내 목표.
- **PR description에 plan 추정 메타 표시 표준화**: 매 PR body에 "라인 수" 표 (추정 vs 실제 + 오차%) 포함 → 회고 시 자동 데이터 수집.

## 3. Action Items

| # | 액션 | 대상 Task | 우선순위 |
|---|------|----------|---------|
| A1 | CANDID-005-FU2 신규 등록 — Application 통합 테스트 + L-007 nested write 회귀 + 5 query.application op trigger | (신규 task) | **P1** |
| A2 | L-010 description 갱신 — SSOT 5쌍 분기 +60 / 테스트 1:1.3 / prisma format +20% 보정 노트 | lessons-learned.json | P1 |
| A3 | (micro) `lib/prisma/extends.ts`의 5쌍 분기 → 매핑 테이블 + 단일 루프 리팩토링 | (별도 micro) | P2 |
| A4 | (micro) `currentStage`/`result` `z.string()` → enum 강화 + maskName/Email 1글자 정책 통일 | (별도 micro) | P2 |
| A5 | `docs/security/pii-masking-policy.md` 신설 + conventions database.md "PII wiring 3-layer 체크리스트" 추가 | (별도 task) | P2 |
| A6 | (micro) surrogate pair/4-byte 이모지 + applicationPublicSchema reject 케이스 분리 | (별도 micro) | P3 |
| A7 | PR description "라인 수" 표 표준화 (추정 vs 실제 + 오차%) — 다음 task plan부터 | (정책) | P2 |

## 4. 학습 항목 후보 (lessons-learned.json 반영)

| ID | Category | 제목 | 변경 | Impact |
|----|----------|------|------|--------|
| L-006 (기존) | security | PII 같은 민감 컬럼은 3-layer defense-in-depth (정적 + 직렬화 + 런타임)로 보호 | appliedCount **1 → 2** (Application 평행 구조 완성) | high (유지) |
| L-007 (기존) | architecture | Prisma `query.{model}.{op}` 후크는 top-level write only — nested write 우회 가능 | appliedCount **1 → 2** (Application query 후크 통합 + 한계 docstring) | high (유지) |
| L-010 (기존) | process | Plan 단계의 라인 추정 정확도는 review fix 비용 사전 반영 + step 책임 단순화에서 온다 | **description 갱신 (보정 모델 v2)** + appliedCount **3 → 4** | medium (유지) |
| L-013 (기존) | architecture | PostgreSQL 부분 인덱스 — 특정 status 필터링 쿼리에 size·성능 우위 | 본 task 무관 — 변경 없음 | medium (유지) |
| L-017 (기존) | architecture | PII snapshot은 실시간 PII와 분리 — 암호화 wiring은 schema 골격과 분리 가능 | appliedCount **1 → 2** (wiring 첫 완성) | medium (유지) |
| L-019 (신규) | process | In-task self-correction — 직전 step review MAJOR를 다음 step PR에서 자체 보강 (fix loop 없이 회수) | 신규 | medium |
| L-020 (신규) | architecture | PII wiring 5쌍 명시 분기 vs 매핑 테이블 트레이드오프 — 필드별 normalize 함수 차이로 derive 불가 시 명시 분기 채택, 신규 필드 추가 비용 ↑ | 신규 | medium |
| L-021 (신규) | process | piiExtension 단일 객체 vs 모델별 분리 변곡점 — 3+ 모델 진입 시 `composePiiExtensions([...])` 팩토리 고려 | 신규 | low |

---

**리포트 경로**: `docs/retro/CANDID-034-retro.md`
