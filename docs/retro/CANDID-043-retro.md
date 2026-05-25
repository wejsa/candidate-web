# CANDID-043 회고: 회귀 가드 wiring meta-guard (4-Layer 방어 완성)

| 항목 | 값 |
|------|-----|
| **Task ID** | CANDID-043 |
| **제목** | 회귀 가드 wiring meta-guard (3종 세트 자동 일관성 검증) |
| **Type / Priority** | chore / high |
| **Phase** | 1 |
| **출처** | CANDID-042 retro Action Item HIGH-A1 (D-MAJOR-4 + T-MAJOR-2/3) |
| **의존** | CANDID-038 / 041 / 042 (모두 merged) |
| **생성일** | 2026-05-25 21:09 |
| **완료일** | 2026-05-25 23:09 |
| **소요 (claim→완료)** | ~70분 (plan 30분 + impl/redesign 25분 + review 10분 + merge 5분) |
| **Step / PR** | 1 step / PR [#63](https://github.com/wejsa/candidate-web/pull/63) |
| **머지 라인** | +494 / -8 (= 486 net, prLineLimit 350×1.4=490 직전 차단 미달) |
| **fix loop** | 1회 (보안/일관성 MAJOR 2건 in-PR fix) |
| **선례** | **CANDID-038/041/042의 3-layer 위에 4-layer 추가 — closed loop 완성** |

---

## 1. Speed (속도)

| 단계 | 시각 | 누적 |
|-----|------|------|
| Task claim | 22:00 | - |
| Plan + AskUserQuestion (preflight vs 매핑 표) | ~22:30 | +30m |
| Step 1 PR 생성 | 22:57:55 | +57m |
| Review 완료 + in-PR fix | 23:08:20 | +1h08m |
| Squash merge | 23:09:03 | +1h09m |

**병목**:
1. **plan 단계 30분** — preflight vs 매핑 표 통합 방식 + META vs USER 구분 + binding 모델 설계 검토
2. **impl 중 algorithm redesign** (~10분 손실) — 초기 알고리즘이 "npm script name = file base name" 가정으로 작성됐으나, 실제 프로젝트 검증 시 `check:migrations` ↔ `check-migrations-no-concurrently.mjs` mismatch 발견. binding 모델(package.json scripts가 SSOT)로 즉시 재설계
3. Review 7분(3-에이전트 병렬) — 토큰/시간 부담은 상수

---

## 2. Quality (품질)

| 지표 | 값 |
|------|-----|
| CRITICAL | **0건** |
| MAJOR | **12건** (4 closed loop 중 최대) |
| MINOR | 7건 |
| INFO | 7건 |
| 보안 MAJOR | **0건** (Security agent APPROVED) |
| 첫 리뷰 통과율 | COMMENT (self-PR) |
| fix loop | 1회 (2 in-PR fix, 10 carry) |
| 신규 vitest | 12건 (clean 2 / missing 4 / orphan 4 / env-error 1 / self-integrity 1) |
| **Pre-Review Guard preflight** | **PASS (G-META-WIRING 첫 운영 사례)** |
| 빌드/lint/typecheck/check:migrations | 모두 통과 / 회귀 0 |

**총평**: 12 MAJOR는 closed loop 4 task 중 최대지만 모두 도메인/아키텍처/테스트 영역의 *설계 트레이드오프 및 edge case 보강* — 보안 우회 경로 없음 (Security MAJOR 0). 본 PR이 도입한 §2.4 step 0 preflight가 자기 자신에게 적용되어 self-validation 통과한 것이 가장 큰 quality signal.

---

## 3. Patterns (패턴)

### Self-validation closed loop 첫 운영 사례
CANDID-042에서 도입된 §2.4 step 0 preflight가 *본 PR의 review 단계에서 즉시* `G-META-WIRING` 가드를 실행하여 1 entry 4자 일치를 검증. CANDID-042 → 043 사이 갭 없이 wiring이 활성화됐다는 closed loop의 강력한 증거.

### Meta-meta-test 패턴 (L-034 두 번째 적용)
- CANDID-041: 가드 스크립트 → 가드 vitest (L-034 첫 적용)
- CANDID-043: meta-guard 스크립트 → meta-guard vitest (L-034 두 번째)

각 layer가 자체 vitest 동반이라는 정책이 일관 적용. 향후 layer 5+ 도입 시에도 동일 패턴.

### impl 단계 algorithm redesign 패턴
초기 가정("npm script name = file base name")이 실제 프로젝트 검증에서 깨졌고, 즉시 binding 모델로 재설계. **impl 중 발견 가능한 결함은 review까지 미루지 않는 게 비용 최저** — review 후 변경은 plan 결정 번복 + 3-에이전트 재검증 비용 큼.

### 라인 수 budget 관리 — 차단 임계 직전 트림
초기 in-PR fix가 prLineLimit 350×1.4=490 임계 초과 (499 lines) → 2개 자유 fixture를 1개로 통합 (assertion은 모두 유지) → 486 lines로 트림. **review fix는 가치 ≪ 라인 부담을 정량 측정하고 fixture 조합으로 압축 가능**.

### 보안 강점의 일관성 (CANDID-042 시리즈 효과)
- CANDID-042 L-038 (declarative 표 명령어 column 화이트리스트)
- CANDID-042 L-039 (exit 2 환경 변경 PR escalation)
- 본 PR에서 두 정책 모두 일관 적용 — Security agent MAJOR 0. 회고 시스템이 누적 학습을 *다음 task에 자동 적용*하는 closed loop 확인.

---

## 4. Decisions (설계 결정)

### 결정 1: 통합 방식 — Preflight (§2.4 step 0) vs 매핑 표 행 추가
- **선택**: Preflight (사용자 AskUserQuestion 확정)
- **근거**: META-LEVEL vs USER-LEVEL 가드 개념 분리. 단일-glob 1-구조 유지. 빠른 실행 (수십 ms)
- **결과**: 깔끔한 분리. 향후 추가 META 가드(D-5 carry)는 동일 preflight에 배치 가능

### 결정 2: Binding 모델 (npm script name vs file base name)
- **초기 가정**: npm name = file base name (예: `check:migrations` → `scripts/check-migrations.mjs`)
- **재설계**: package.json scripts entry가 SSOT — `check:migrations` → `node scripts/check-migrations-no-concurrently.mjs` (alias 자유)
- **근거**: npm script alias의 자유로움 + 실제 프로젝트의 `check:migrations` ↔ `check-migrations-no-concurrently.mjs` mismatch 케이스
- **트레이드오프**: binding 모델은 복잡도 증가, 그러나 npm alias 패턴 표준 준수

### 결정 3: Dynamic self-detection (`import.meta.url`) vs 정적 하드코딩
- **초기**: `META_SCRIPT_PATH = 'scripts/check-guard-wiring-consistency.mjs'` 등 상수 3개
- **review fix**: `import.meta.url` 기반 `SELF_BASE` 도출 + canonical 경로 재구성
- **근거**: rename 회귀가 build/test에서 안 깨지는 silent failure 차단 + L-037 self-application 강화
- **트레이드오프**: fixture(tmpdir cwd ≠ script location)에서 cwd-relative 충돌 발생 → `existsSync(SELF_SCRIPT_PATH)` gate로 production-only 실행

### 결정 4: in-PR fix vs Carry 분기 (12 MAJOR 중)
- **in-PR fix 2건**:
  - D-2 + T-5 (dynamic self-detection): silent failure 차단 — 머지 전 필수
  - T-2 + T-6 (continue invariant 동결): 알고리즘 invariant — 머지 전 필수
- **carry 10건**: 설계 트레이드오프 / edge case 보강 / future META 가드 도입 시점 / DRY 추출 — 별도 task 적합

### 결정 5: 라인 budget 트림
- **초기 in-PR fix**: 499 lines (차단 임계 490 초과)
- **트림**: 2개 self-* fixture → 1개로 통합 (assertion 모두 보존) → 486 lines (차단 미달)
- **메타 학습**: 라인 budget 임계 직전에서는 *fixture 조합* + *주석 압축* 권장 (assertion 강도 유지)

---

## 5. Lessons (학습)

### Keep (유지)
- **AskUserQuestion 기반 핵심 설계 결정**: plan 단계에서 preflight vs 매핑 표 행 — 의사결정 추적성 + 향후 변경 시 근거 명확
- **3-에이전트 수렴 신호로 우선순위 판단**: D-2/T-5는 domain + test 양쪽 식별 → in-PR fix 우선
- **Closed loop self-application**: 본 PR이 도입한 정책(meta-guard preflight)이 본 PR review에서 즉시 활성화 — wiring 갭 0

### Improve (개선)
- **impl 단계 검증 가속**: 초기 알고리즘을 실제 프로젝트에서 빠르게 검증 (몇 줄 작성 후 즉시 dry-run) — review까지 가서 발견되면 비용 큼
- **plan 단계 binding 모델 명시**: "npm script name과 file path의 매핑 관계는 SSOT가 어디인가?" 질문이 plan에 부재. binding 모델이 SKILL.md 표면이 아닌 plan 단계에서 명확화돼야 함
- **라인 budget 관리 plan-stage 사전 계산**: 예상 라인 (plan ~305) vs 실제 (origin +439 + fix +55-8 = 486) — plan에서 60% 오차. fixture 비중을 plan 단계에 더 정확히 추정 필요

### Learn (학습)
- **Dynamic self-detection의 fixture 호환**: `import.meta.url`은 cwd 독립적 절대 경로 반환 → fixture에서 cwd-relative 검사 시 mismatch 가능. `SELF_BASE`만 동적, 경로는 canonical(cwd 기준) 구성하는 패턴이 양립 가능
- **META vs USER 가드 분리의 가치**: 단일 §2.4 표 구조 유지하면서 META 가드는 별도 preflight로 분리 — 표 multi-glob 파싱 규칙 도입 회피
- **Closed loop의 자연 증가 임계**: 4 task 누적 21 carry MAJOR (4+3+6+8). L-022 "MAJOR carry-over 7건+ 시 별도 fix PR 분리"의 *task 단위* 기준이지만, *closed loop 단위*에서는 누적 임계 재정의 필요 가능성 (CANDID-042 회고에서 이미 노트)

### Try (시도)
- **carry 10건 통합 task** (CANDID-044): D-1/D-3/D-4/D-5/D-6 + T-1/T-3/T-4 — 모두 design refinement + edge case. 단일 task로 묶어 efficiency ↑
- **meta-guard 도입 비용 표준화**: 본 PR의 ~486 lines = 4-layer 완성 비용. 향후 *다른 도메인의* meta-guard (예: dep-check) 도입 시 ~300 lines + DRY 추출(`spawn-guard.ts`) 활용으로 비용 절감 가능

---

## 6. Action Items (follow-up task 등록 권장)

### MEDIUM
| ID | 제안 task | 근거 lesson |
|----|----------|------------|
| **A1** | CANDID-044 (또는 신규) — meta-guard 설계 refinement 통합: D-1 exit 2 자체 보고 + D-3 binding alias 일관성 + D-4 PKG_VALUE_RX runner 화이트리스트 + D-5 META 디렉토리 분리 (`scripts/meta/`) + D-6 SKILL.md 섹션 번호 결합 회피 + T-1/T-3/T-4 fixture 보강 | 본 PR carry 10건 |
| **A2** | `tests/scripts/_helpers/spawn-guard.ts` 추출 — CANDID-041 + CANDID-043 동일 패턴 + 향후 가드의 4번째 세트(dry-run) | CANDID-041 A-2, CANDID-042 T-INFO-1, 본 PR T-MINOR-1 |

### LOW
| ID | 제안 task |
|----|----------|
| **A3** | npm script lifecycle hook 화이트리스트 가드 (`prepublish` 등) — 본 PR Security MINOR — 별도 보안 강화 task |

> **참고**: 본 회고는 closed loop 완성 task이므로 신규 layer 추가 task는 제안 안 함. 다음 layer(layer 5)는 새 회귀 가드 도입이 트리거가 될 때까지 대기.

---

## 7. 학습 반영 제안

### lessons-learned.json 업데이트

#### 기존 항목 갱신 (appliedCount 증가)
- **L-034**: appliedCount 1 → **2** (CANDID-041 + 043 두 번째 적용 — meta-meta-test)
- **L-036**: appliedCount 2 → **3** (preflight 첫 실 운영 사례)
- **L-037**: appliedCount 1 → **2** (본 PR도 self-application 통과 검증 — README/SKILL.md/scripts 정합성 유지)

#### 신규 lessons (3건 제안)

1. **L-040** (architecture, medium):
   *Binding 모델 — alias 관계에서 SSOT 위치를 명확화. 양방향 매핑이 아닌 *원본 → 별칭* 단방향 정의*
   description: `skill-review-pr` §2.4 매핑 표는 npm script name(예: `check:migrations`)만 정의. 실제 파일 경로는 `package.json scripts[npm-script]` 값에 정의 — package.json이 SSOT. CANDID-043 impl에서 초기 가정("npm name = file base name") 깨진 후 binding 모델로 재설계. 일반화: 시스템에 alias가 있을 때 양방향 추론 가능 코드는 한 방향이 깨질 때 silent failure. SSOT 한 곳을 정하고 반대 방향은 도출만 허용.

2. **L-041** (process, medium):
   *impl 단계 algorithm 검증 가속 — 초기 가정을 실제 프로젝트에서 즉시 dry-run, review까지 미루지 않기*
   description: CANDID-043 impl에서 초기 알고리즘이 실제 매핑(`check:migrations` ↔ `check-migrations-no-concurrently.mjs`)에서 깨진 것을 즉시 dry-run으로 발견 → binding 모델 재설계. review 단계까지 끌었다면 3-에이전트 재검증 비용 + plan 결정 번복 부담. 정책: impl 중 핵심 알고리즘은 실 데이터로 한 번 dry-run 후 단위 테스트 작성. plan 가정이 실 케이스와 일치하는지 cross-check.

3. **L-042** (architecture, medium):
   *Dynamic self-detection 패턴 — import.meta.url 기반 SELF_BASE 도출 + canonical cwd-relative 경로*
   description: meta-guard / self-validating tool에서 정적 하드코딩(상수)은 rename 회귀에 silent failure 위험. `import.meta.url` 기반 `SELF_BASE`(basename 추출) + `${dir}/check-${SELF_BASE}.{ext}` canonical 경로 구성 시 rename 자동 추종 + fixture(tmpdir) 호환. self-integrity check는 `existsSync(SELF_PATH)` gate로 production-only 실행 → 일반 fixture 회귀 회피. CANDID-043 D-2/T-5 in-PR fix.

### 컨벤션/체크리스트 갱신 제안 (사용자 승인 필요)

- `_base/checklists/common.md` §"회귀 가드 도구 도입"에 다음 1행 추가:
  - **Dynamic self-detection 권장** (L-042) — self-validating tool의 self-paths는 정적 상수 대신 `import.meta.url`/`SELF_BASE` 기반 동적 도출. rename 회귀 자동 차단

- `_base/conventions/` 신규 또는 기존 적합 위치에 L-040 binding 모델 패턴 추가 검토 (architecture or naming convention)

CLAUDE.md는 절대 수정 금지.

---

## 8. 메트릭 요약 + Closed Loop 종합

### CANDID-043 단독
| 메트릭 | 값 |
|---|---|
| Speed | ~70분 (plan 30 + impl/redesign 25 + review 10 + merge 5) |
| Quality | CRITICAL 0 / MAJOR 12 / fix loop 1 |
| Code | +494/-8 = 486 net (prLineLimit 350×1.4=490 직전) |
| Tests | 12 신규 / 1120 total / self-validation OK |
| Carry | 10건 (medium-low) |

### Closed Loop 4-Layer 종합 (CANDID-038 → 041 → 042 → 043)

| Task | Layer | 라인 | fix loop | carry | lessons (add) |
|------|-------|------|---------|-------|-------------|
| **CANDID-038** | 1 (가드 도입) | +113 | 1 | 4 | L-034/035/036 신규 (정의) |
| **CANDID-041** | 2 (가드 자체 테스트) | +252 | 1 | 3 | (없음 — L-034 첫 적용 사례) |
| **CANDID-042** | 3 (가드 호출 wiring) | +73 | 1 | 6 | L-037/038/039 신규 |
| **CANDID-043** | 4 (wiring 일관성 meta-guard) | +486 | 1 | 8 | L-040/041/042 제안 (본 회고) |
| **합계** | **4-layer 완성** | **+924** | **4** | **21** | **9 신규 + 다수 적용** |

**총평**:
- closed loop는 의도대로 작동 — 각 task가 다음 layer trigger
- fix loop 일관 1회 — 회귀 가드 도입의 안정적 비용 (impl + review + 1 fix)
- carry 21건 누적 — L-022 임계(7건+) 4 task 단위로는 초과지만, *layer 도입* 특성상 surface된 design refinement 다수 → 자연스러운 누적
- lessons 9건 신규 — 각 layer가 1-3건 학습 추가, L-034가 2회 적용으로 promotion 후보

**향후**:
- 4-layer로 회귀 가드 도입 비용 표준화 (3종 세트 PR + SKILL.md 표 추가 → meta-guard 자동 검증)
- 다음 layer 도입은 *새 회귀 가드 종류*(예: lint, semgrep, sbom)가 트리거가 될 때까지 대기
- carry 21건 중 10건 통합 task(CANDID-044 후보)로 closed loop refinement 단계 진입
