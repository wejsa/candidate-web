# CANDID-038 회고: CANDID-013 마이그 CONCURRENTLY 제거 (L-029 회귀)

| 항목 | 값 |
|------|-----|
| **Task ID** | CANDID-038 |
| **제목** | CANDID-013 마이그 CONCURRENTLY 제거 (L-029 회귀 위험) |
| **Type / Priority** | bug / critical |
| **Phase** | 1 (기반/인프라) |
| **출처** | CANDID-016 retro Action Item HIGH-1 |
| **생성일** | 2026-05-25 11:00 |
| **완료일** | 2026-05-25 17:23 |
| **소요 (생성→완료)** | ~6.4시간 (실제 hands-on 단일 세션 ~30분) |
| **Step / PR** | 1 step / PR [#60](https://github.com/wejsa/candidate-web/pull/60) |
| **머지 라인** | +113 / -0 (prLineLimit 200, 56%) |
| **테스트** | 1092 pass / 0 added |
| **fix loop** | 1회 (in-PR fix) |
| **선례** | CANDID-016 v2 (DROP+CREATE 패턴) |

---

## 1. Speed (속도)

| 단계 | 시각 | 누적 |
|-----|------|------|
| Task claim | 17:13:18 | - |
| plan 승인 | 17:13:18 | 0초 |
| Step 1 PR 생성 | 17:13:18 | 0초 |
| review 완료 + in-PR fix | 17:21:46 | +8분 28초 |
| Squash merge | 17:23:50 | +10분 32초 |

**병목**: 본 task에는 의미 있는 병목이 없었음 — 단일 step, fix loop 1회로 종료. review 단계의 3-에이전트 병렬 분석이 가장 큰 시간 비중(~6분).

**참고**: execution-log의 task_started/plan_approved/pr_created 타임스탬프가 동일(17:13:18)한 것은 backlog 갱신 스크립트가 일괄 기록한 부산물 — 실제 plan→impl→PR은 ~30분 분포.

---

## 2. Quality (품질)

| 지표 | 값 |
|------|-----|
| CRITICAL | **0건** |
| MAJOR | 5건 (in-PR fix 1, carry 4) |
| MINOR | 4건 (in-PR fix 1, carry 3) |
| INFO | 5건 |
| 첫 리뷰 통과율 | COMMENT (self-PR, REQUEST_CHANGES 없음) |
| fix loop | 1회 (정규식 멀티라인 + 블록 주석) |
| 신규 vitest | 0건 (plan에서 deferral, T-MAJOR-1로 carry) |
| 빌드/lint/typecheck | 전부 PASS |
| 가드 fixture 수동 검증 | 5/5 통과 (라인 주석/블록 주석 SKIP, 멀티라인/UNIQUE/탭 DETECT) |

**총평**: 명확한 단일 목적(L-029 회귀 차단), pre-launch 환경, 작은 라인 변경(+113) 덕분에 quality는 양호. 다만 가드 자체의 단위 테스트 부재(T-MAJOR-1)는 가드 무결성 보증 측면에서 follow-up task로 즉시 해소 필요.

---

## 3. Patterns (패턴)

### 회고 follow-up task의 정확한 실행 사례
CANDID-016 회고에서 L-029 + HIGH-1 Action Item으로 등록된 task가 본 task에서 **정확히 의도대로 실행**됨. lessons-learned 시스템이 follow-up까지 닫는 closed loop 작동 확인.

### "자동 가드 도입 PR 자체의 신뢰성 공백" 패턴
3개 리뷰 에이전트 모두 독립적으로 "가드 스크립트 자체의 단위 테스트 부재" 지적 (T-MAJOR-1). 가드 도구 도입 PR 공통 패턴 — 가드는 무성 실패 시 차단 효과 0이라는 점이 사후에야 드러남.

### "정규식 라인 단위 매칭의 멀티라인 false-negative" 패턴
3개 에이전트 모두 `RX.test(lines[i])` 라인 단위 매칭의 한계 지적 (D-MAJOR-1 + S-MAJOR-1 + T-MAJOR-2). PostgreSQL이 `CREATE INDEX\n  CONCURRENTLY ...` 같은 토큰-내 줄바꿈을 허용하므로 우회 가능. in-PR fix로 파일 전체 매칭 + `stripSqlComments` 헬퍼 도입으로 해소.

### 자기 PR 패턴 (반복)
COMMENT review 결정 — 자기 PR + CRITICAL 0 → APPROVE 불가, COMMENT 후 머지. CANDID-013/016과 동일 패턴.

---

## 4. Decisions (설계 결정)

### 결정 1: 신규 마이그 추가 vs 기존 마이그 파일 수정
- **선택**: 신규 마이그 (`20260525113000_candid_038_jp_indexes_no_concurrently/`)
- **근거**: Prisma migration history integrity (한 번 머지된 마이그는 변경 불가). CANDID-016 v2 선례 답습. dev/staging의 v1 적용 환경에서 drift 회피.
- **트레이드오프**: 마이그 chain이 길어짐. 신규 dev 환경에서 v1이 실패할 가능성 잔존 (D-INFO-1로 carry, 수동 검증).

### 결정 2: 인덱스 생성 방식 (일반 CREATE INDEX vs runbook + IF NOT EXISTS)
- **선택**: 일반 `CREATE INDEX IF NOT EXISTS` (CONCURRENTLY 없이)
- **근거**: `job_postings` 운영 row 0건 (pre-launch). 누적 추정 수백~수천. ACCESS EXCLUSIVE 락 ms 수준 — 운영 안전.
- **임계치 명시**: 마이그 SQL 주석에 "row 수 100k+ 도달 시 runbook 전환" 트리거 명문화.

### 결정 3: 회귀 가드 위치 (npm script vs husky/CI)
- **선택**: `package.json` npm script (`check:migrations`) — 가장 가벼움
- **근거**: husky/CI workflow 인프라 미존재 (`.github/workflows/`, `.husky/` 부재). PR 리뷰가 conventions 참조해 호출하도록 README 명시.
- **트레이드오프**: 자동 호출 wiring 부재 (D-MAJOR-1로 carry). 현재는 README "PR 리뷰에서 호출" 선언만 있고 메커니즘 없음.

### 결정 4: 가드 자체 vitest 테스트 (in-PR vs follow-up)
- **선택**: follow-up (T-MAJOR-1로 carry)
- **근거**: plan 단계에서 "수동 검증으로 갈음. 부담 증가 회피" 명시 결정
- **반성**: 리뷰 에이전트 3개 모두 "MUST 본 PR 포함"으로 지적. *가드 도입 PR은 가드 테스트 동반이 표준이 되어야 함*. 본 task의 가장 큰 학습.

### 결정 5: in-PR fix 범위 (정규식 멀티라인만 vs 가드 테스트 포함)
- **선택**: 정규식 결함만 in-PR fix (+21 lines), 가드 vitest는 carry
- **근거**: 정규식은 본 PR의 새 코드 결함 → 즉시 해결. 가드 vitest는 ~140줄 추가로 라인 부담 가중 + plan 결정 존중.

---

## 5. Lessons (학습)

### Keep (유지)
- **DROP+CREATE 신규 마이그 패턴** (CANDID-016 v2 선례): Prisma history integrity 유지하며 안전한 인덱스 재구축. 향후 동일 시나리오의 표준 방식.
- **회고 → follow-up task 등록 → 정확 실행 closed loop**: lessons-learned 시스템의 정상 작동 사례.
- **DB-designer 서브에이전트의 plan 단계 활용**: 4가지 결정 사항(규모/패턴/방식/회귀가드)에 대한 정밀한 권고를 받아 plan 품질 향상.

### Improve (개선)
- **회귀 가드 도입 PR에 가드 자체 테스트 동반 필수** — T-MAJOR-1을 follow-up으로 분리한 것이 본 task의 가장 큰 반성. *가드 도구 PR 표준 절차* 필요.
- **plan 단계에서 "테스트 부담 회피" 결정 시 리뷰 단계의 surfacing 예측 부재** — plan 결정 vs review 결과의 mismatch 비용 인지 필요.
- **README 선언과 메커니즘 부재의 gap**: "PR 리뷰에서 호출" 같은 선언은 자동화 메커니즘 없이 신뢰할 수 없음. 선언 시점에 wiring 동반.

### Learn (학습)
- **정규식 라인 단위 매칭의 한계**: PostgreSQL/SQL은 토큰 간 줄바꿈 허용 → `^...$` 라인 매칭은 무력. 파일 전체 매칭 + `stripSqlComments`로 정밀화 가능.
- **stripSqlComments의 라인 보존 트릭**: 코멘트를 공백으로 치환하되 개행은 보존 → `match.index → split('\n')`로 원본 라인 번호 정확 재계산.
- **allowlist 명예 시스템의 거버넌스 공백**: PR 리뷰만이 차단점인 allowlist는 CODEOWNERS/컨벤션 명문화 필요.

### Try (시도)
- 다음 follow-up task(가드 vitest)에서 fixture 패턴 (tmpdir + fs)을 정형화 → 향후 유사 가드 도구 도입 시 재사용 가능한 헬퍼 정립.
- `skill-review-pr`의 SKILL.md에 "마이그 파일 변경 감지 시 `pnpm check:migrations` 자동 실행" hook 절차 추가.

---

## 6. Action Items (follow-up task 등록 권장)

### HIGH (즉시 등록)
| ID | 제안 task | 추정 라인 | priority |
|----|----------|---------|----------|
| **A1** | 회귀 가드 vitest 단위 테스트 (6 fixture: positive/negative/comment/multiline/UNIQUE/edge) | ~140 | high |
| **A2** | 회귀 가드 자동 호출 wiring (`skill-review-pr/SKILL.md` Step 2.x + 옵션: `.github/workflows/` 또는 husky pre-push) | ~80 | high |

### MEDIUM
| ID | 제안 task | 추정 라인 | priority |
|----|----------|---------|----------|
| **A3** | `pg_indexes` 통합 테스트 — 4종 인덱스 정의 회귀 가드 (`tests/integration/migrations/candid-038-jp-indexes.test.ts` + `getIndexInfo` 헬퍼) | ~80 | medium |
| **A4** | allowlist 거버넌스 컨벤션 — `database.md` §회귀 가드 강화 + `CLAUDE.md` DB 컨벤션 1줄 + (선택) CODEOWNERS | ~50 | medium |

### LOW
| ID | 제안 task | priority |
|----|----------|----------|
| **A5** | 가드 스크립트 exit code 2 → CI false-positive 조정 (또는 README "Prisma 사용 프로젝트 전용" 명시) | low |
| **A6** | DROP+CREATE 락 윈도우 prerelease 체크리스트 추가 (row 수 검증 단계 명문화) | low |
| **A7** | CANDID-013 v1 마이그가 fresh dev env에서 `migrate reset`으로 실행 가능한지 수동 검증 (D-INFO-1) | low |

---

## 7. 학습 반영 제안

### lessons-learned.json 업데이트
- **L-029 appliedCount**: 1 → **2** (본 task가 두 번째 적용 사례)
- **L-022 appliedCount**: 2 → **3** (7건 carry → 별도 follow-up task 분리 패턴 확인)

### 신규 lessons (3건 제안)
1. **L-NEW-A** (process, high): "회귀 가드 도입 PR에 가드 자체의 단위 테스트 동반 — 가드는 무성 실패 시 차단 효과 0이고 그 사실조차 알 수 없음. 가드 도구 도입 PR의 표준 절차"
2. **L-NEW-B** (architecture, medium): "정규식 라인 단위 매칭은 멀티라인 SQL/코드 false-negative — 파일 전체 매칭 + comment strip(라인 보존)으로 정밀화"
3. **L-NEW-C** (process, medium): "README/문서의 자동화 선언은 wiring 메커니즘 없이 신뢰 불가 — 선언 시점에 wiring 동반 또는 follow-up task 즉시 등록"

### 컨벤션/체크리스트 갱신 제안 (사용자 승인 필요)
- `_base/conventions/database.md` §"Prisma migrate deploy의 트랜잭션 wrap" — 실제 가드 도구(`pnpm check:migrations`) + allowlist 운영 절차 명시 (현재는 "권장"만 적힘)
- `_base/checklists/common.md` — "회귀 가드 도입 PR은 가드 자체의 단위 테스트 동반" 항목 추가
- `CLAUDE.md`의 "코딩 컨벤션 → DB" 섹션 1줄 추가 (CLAUDE.md 직접 수정은 컨벤션상 금지 → 사용자 안내만)

---

## 8. 메트릭 요약

| 카테고리 | 메트릭 | 값 |
|---------|--------|---|
| **Speed** | 실제 hands-on 소요 | ~30분 (단일 세션) |
| **Quality** | CRITICAL / fix loop | 0 / 1 |
| **Code** | 라인 (PR 기준) | +113 / -0 |
| **Code** | 신규 파일 / 수정 | 3 / 2 |
| **Tests** | passing | 1092 / 1092 |
| **Carry** | follow-up 항목 | 7건 (HIGH 2, MEDIUM 2, LOW 3) |
| **lessons-learned** | 적용 / 신규 제안 | 2 / 3 |

본 task는 회고 시스템의 의도된 closed loop(회고→follow-up→실행→재회고)를 정확히 따른 모범 사례인 동시에, "가드 도구 도입 PR의 가드 테스트 동반"이라는 새로운 표준 절차 학습 계기.
