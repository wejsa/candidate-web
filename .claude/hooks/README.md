# .claude/hooks/ — Native Lifecycle Hooks

> **상위 계획**: [docs/v2/phase-1-plan.md](https://github.com/wejsa/ai-crew-kit/blob/main/docs/v2/phase-1-plan.md)
> **TFT 분석**: [docs/v2/phase-1-tft-analysis.md](https://github.com/wejsa/ai-crew-kit/blob/main/docs/v2/phase-1-tft-analysis.md)
> **도입 버전**: v2.0.0-alpha.2 (Phase 1 Step 2~)
>
> kit dev 문서 링크는 ai-crew-kit GitHub 리포를 가리킵니다. 사용자 프로젝트에는 `docs/`가 포함되지 않습니다(자동 정리됨). **버전 주의**: `blob/main`은 최신 기준이며 사용자 시드 시점(`project.json.kitVersion`)과 다를 수 있습니다.

Claude Code 네이티브 훅으로 ai-crew-kit 워크플로우 자동화를 구현합니다. 훅이 비활성화되어도 v1.x 동작은 100% 유지됩니다.

---

## 디렉토리 구조

```
.claude/hooks/
├── README.md                     이 파일
├── lib/
│   └── atomic-write.sh           flock/mkdir 기반 원자적 쓰기 helper (R5)
├── diagnose.sh                   v2.1.3: read-only hook 진단 도구
├── session-start.sh              SessionStart: git sync + 상태 로드          [bookkeeping]
├── stop.sh                       Stop: 만료 잠금 해제 + continuation-plan     [bookkeeping]
├── post-tool-use.sh              PostToolUse: lockedAt heartbeat + 루프 방어   [bookkeeping]
└── pre-tool-use.sh               PreToolUse: 머지 품질 게이트 (v2.4.0)         [gate]
```

---

## 훅의 두 카테고리: Bookkeeping vs Gate (중요)

훅은 목적에 따라 두 부류로 나뉘며, 차단 정책이 **정반대**다. 이 구분이 SSOT다.

| 카테고리 | 훅 | 차단 정책 | 근거 |
|---------|-----|----------|------|
| **Bookkeeping** | session-start, post-tool-use, stop | **절대 비블로킹** (R4 — 모든 경로 `exit 0`) | 상태 기록/동기화가 일이다. 실패해도 세션을 막아선 안 된다. |
| **Gate** | pre-tool-use | **설계상 블로킹** (`exit 2`로 거부) | 품질 게이트 강제가 일이다. "CRITICAL 머지 차단"을 prose 지시가 아니라 결정적으로 강제한다. |

**핵심 원칙**: Gate 훅도 **인프라 실패(도구 부재·파싱 불가·상태 부재·네트워크)에는 fail-open(`exit 0`)** 한다 — 게이트 *자체의 장애*가 정상 작업을 막아선 안 되기 때문이다. Gate 훅이 `exit 2`를 내는 건 오직 **신호가 명확히 차단을 가리킬 때**뿐이다. 그리고 항상 **명시 우회 경로**(env)를 제공한다.

> Gate 훅은 파일 상단에 `# hi04-exempt: gate-hook` 마커를 선언해야 HI-04 정적 검사의 exit-2 금지에서 면제된다(opt-in). 마커 없는 훅의 `exit 2`는 여전히 위반으로 잡힌다.

### Bookkeeping 훅 작성 규칙

Bookkeeping 훅은 **Claude 세션을 절대 차단하지 않아야** 합니다. 다음 규칙을 지키세요.

| 금지 | 이유 | 대안 |
|------|------|------|
| `exit 2` | Claude Code는 exit 2를 "tool 호출 블록" 시그널로 해석 — 세션 흐름 차단 | 모든 에러 경로 `exit 0` + stderr 로그 |
| `set -e` (단독) | 중간 명령어 실패가 세션 차단으로 전파 | `... \|\| true` 또는 개별 체크 + `exit 0` |
| `set -u` / `set -o pipefail` | 미정의 변수/파이프 실패가 비의도적 차단 유발 | 명시적 조건 체크 |
| 대화형 프롬프트 유발 명령 | `git pull`(HTTPS credential), `ssh`, `sudo` 등이 터미널에서 입력을 대기 → 사용자 터미널이 hang | 훅 초반에 `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=/bin/true`, `GCM_INTERACTIVE=never` export + 필요 시 `exec 0</dev/null` |

**HI-04** (`scripts/check-hook-blocking.sh`) 정적 검사로 위 규칙 위반(단독 `exit 2` 포함)을 자동 탐지합니다. `# hi04-exempt: gate-hook` 마커를 선언한 Gate 훅만 exit-2 검사에서 면제됩니다(`set -e` 검사는 Gate 훅에도 적용 — fail-open 보장).

### 대화형 프롬프트 차단 레시피 (필수)

훅이 git을 호출한다면 **반드시** 스크립트 상단에 다음을 삽입하세요. 누락 시 HTTPS remote + credential manager 미캐시 상태에서 **사용자 터미널이 무한 프롬프트 루프**에 빠집니다.

```bash
export GIT_TERMINAL_PROMPT=0      # git 자체 프롬프트 차단
export GIT_ASKPASS=/bin/true      # askpass 헬퍼도 차단
export GCM_INTERACTIVE=never      # Windows Git Credential Manager (WSL) GUI 팝업 차단
exec 0</dev/null                  # stdin을 /dev/null로 — 자식 프로세스가 stdin 대기 못 하게
```

검증: 존재하지 않는 HTTPS remote로 `git pull`이 호출돼도 **≤1초** 안에 실패해야 함. 10초 이상 걸리면 프롬프트에 걸린 신호.

---

## 현재 등록된 훅

### PreToolUse (`pre-tool-use.sh`) — Gate (v2.4.0)

**발동 시점**: 모든 `Bash` 도구 호출 직전
**timeout**: 10초
**매처**: `Bash`
**목적**: `gh pr merge` 직전, 미해결 CRITICAL이 있는 PR의 머지를 **결정적으로 차단**한다. 기존엔 "CRITICAL은 머지 차단"이 prose 지시(skill-merge-pr/CLAUDE.md)였으나, LLM이 review 분기를 한 번만 잘못 따라도 나쁜 PR이 auto-merge되는 구멍이 있었다. 이 게이트가 그 구멍을 닫는다.

**동작**:
1. `gh pr merge`가 아닌 모든 Bash 명령 → 즉시 `exit 0` (의견 없음, 오버헤드 최소).
2. PR 번호 추출 후 **차단 신호** 검사 (둘 중 하나라도 차단이면 deny):
   - **신호 A (state, 오프라인 결정적)**: PR N을 소유한 Task(`step.prNumber == N` **또는** `workflowState.prNumber == N`)의 `workflowState.lastReviewDecision == "REQUEST_CHANGES"` → 미해결 CRITICAL 게시됨. PR 번호의 결정적 SSOT는 `step.prNumber`(skill-impl Step 8)이므로 거기서도 join한다 — `workflowState.prNumber`만 보면 실제 backlog에서 발동하지 못한다.
   - **신호 B (GitHub, best-effort)**: `gh pr view N --json reviewDecision == CHANGES_REQUESTED` (타인 PR에서 GitHub가 기록한 request-changes). 네트워크/인증/`gh` 부재 시 fail-open.
3. 차단 시 `exit 2` + stderr에 사유·복구 안내(재리뷰 / 우회) 출력.

**제어 환경변수**:

| 변수 | 효과 |
|------|------|
| `CCK_MERGE_GATE=off` | 게이트 전면 비활성 (allow always) |
| `CCK_GATE_BYPASS=1` | 이번 1회 의도적 우회 — 로그 + allow (사용자 책임) |
| `CCK_GATE_NO_GH=1` | 신호 B(GitHub 네트워크 호출) 전면 스킵 — 오프라인/에어갭 환경 |

**fail-open 시나리오** (게이트 장애가 정상 머지를 막지 않도록 → `exit 0`): `jq` 부재, stdin 부재, backlog 부재, PR 번호 추출 불가, 매칭 `workflowState` 없음, GitHub 조회 실패.

> 신호 A는 `backlog.schema.json`의 `workflowState.lastReviewDecision`(v2.4.0 정식 등록)에 의존한다. 이 필드는 skill-review-pr Step 6.5가 매 리뷰마다 갱신한다. 이전에는 스킬이 참조했으나 schema 미등록(`additionalProperties:false`)으로 거부되던 sleeper였다 — 본 게이트와 함께 정식화되어 skill-fix 모드 판정도 같이 복구됨.
>
> **한계**: kit 개발 리포 자체는 backlog state가 없어 신호 A가 no-op(claim 감지와 동일) — 실효는 사용자 프로젝트에서 발현. 기존 사용자가 업그레이드 시 PreToolUse 등록을 받으려면 `settings.json` 병합이 필요(skill-upgrade 후속 과제).

### SessionStart (`session-start.sh`)

**발동 시점**: Claude Code 세션 시작 시 1회
**timeout**: 30초
**동작**:
1. git sync (워크트리면 `git fetch + merge --ff-only`, 일반 클론이면 `git pull --ff-only`)
2. `.claude/state/continuation-plan.md` 존재 시 stdout 출력
3. `.claude/state/backlog.json`의 `in_progress` Task 목록 안내
4. **develop 미반영 워크트리 claim 감지** (다중 워크트리 동시 선택 안전장치) — `origin/worktree-*` 브랜치를 직접 스캔해, 거기서는 `in_progress`인데 현재 backlog에는 `todo`로 남은 Task(= claim이 아직 develop SSOT까지 전파되지 않은 윈도우)를 경고. 같은 Task를 복수 워크트리가 claim하면 🔴, 단일이면 🔶. 현재 세션 자신의 브랜치는 제외하고, develop에서 이미 `in_progress`(정상 전파됨)거나 `done`/`merged`(머지 후 잔존 브랜치의 stale claim)면 경고하지 않는다.

> 4단계는 `worktree-<name>` 네이티브 브랜치 명명만 감지한다. 임의 브랜치명을 쓰는 수동 worktree는 잡지 못한다. 또한 두 워크트리가 같은 Task를 claim했고 그 중 하나가 이미 develop에 전파된 경우는 §1.5 claim-time 충돌 검사가 1차로 막는 영역이다 — hook은 todo 윈도우만 보완한다.

**graceful skip 시나리오**: git 미설치, jq 미설치, 비-git 디렉토리, `origin/worktree-*` 브랜치 부재 → 경고 로그 또는 조용히 스킵 후 계속.

### Stop (`stop.sh`)

**발동 시점**: Claude 응답 완료 시마다 (세션 종료 아님 — R3)
**timeout**: 15초
**동작**:
1. `stop_hook_active=true` 수신 시 즉시 exit 0 (공식 재귀 방지)
2. backlog.json의 만료(10분 초과) 잠금 해제 (원자적 쓰기)
3. continuation-plan 조건부 갱신:
   - 60초 이내 갱신됐으면 스킵 (디바운스)
   - `workflowState=idle` 또는 `in_progress` Task 0건이면 스킵
   - 그 외: atomic temp write + rename

**stderr 출력 자제**: 매 턴 발동이라 노이즈 방지.

### PostToolUse (`post-tool-use.sh`)

**발동 시점**: `Edit` / `Write` 도구 호출 완료 직후
**timeout**: 10초
**매처**: `Edit|Write`
**동작**: 현재 세션이 `lockedBy`로 소유한 `in_progress` Task의 `lockedAt`을 현재 시각으로 갱신(heartbeat). stop.sh 만료 감지(10분 TTL)와 연동. `lockedBy`/`lockedAt`은 v2.2.0부터 `backlog.schema.json`에 정식 필드로 정의(가변 잠금 의미, `assignee`/`assignedAt`(불변 할당)와 구분).

**3단계 무한 루프 방어 + init 보호 마커** (TFT R1/R2 + v2.2.0):

| 단계 | 트리거 | 동작 |
|------|--------|------|
| 0 | `hook-disabled.flag` 존재 | 즉시 exit 0 |
| 0-A | `init-in-progress.flag` 존재 (mtime ≤ 1h) | 즉시 exit 0. skill-init/onboard 트랜잭션 동안 카운터 진입 자체 차단 (v2.2.0). TTL 초과 마커는 자동 회수. |
| 1 | `file_path`가 `.claude/state/*` 또는 `.claude/temp/*` | 즉시 exit 0 (네이티브 path 필터 부재 — 스크립트 레벨) |
| 2 | 세션별 락(`$TMPDIR/ack-hook-<sid>.lock`) 존재 | 재진입으로 판단, 즉시 exit 0. 정상 경로는 `trap EXIT`로 정리 |
| 3 | `CCK_HOOK_WINDOW_SEC` 윈도우 내 `CCK_HOOK_THRESHOLD` 초과 (기본 10초/3회) | `hook-disabled.flag` 생성 + stderr 경고 로그 |

**graceful skip**: jq 미설치, stdin 비어있음, 소유 Task 없음 → 쓰기 없이 exit 0.

**임계값/윈도우 외부화 (v2.1.3+)**: 환경변수로 기본값을 override 가능. 멀티파일 Edit이 잦은 단독 작업자가 자동 비활성화를 자주 보면 완화하세요.

| 환경변수 | 기본값 | 의미 |
|---------|--------|------|
| `CCK_HOOK_THRESHOLD` | 3 | 윈도우 내 허용 호출 횟수 — 이를 **초과**하면 자동 비활성화 |
| `CCK_HOOK_WINDOW_SEC` | 10 | 카운트 누적 윈도우(초) |

비숫자/0 이하 값은 무시되고 기본값으로 폴백합니다. 미설정 시 회귀 0 (TFT R1/R2 권장값).

**수동 복구**: 자동 비활성화 발동 시 원인 점검 후 플래그 삭제. 점검은 `diagnose.sh` 권장(아래 §진단 도구).
```bash
rm .claude/state/hook-disabled.flag
rm .claude/state/hook-trigger-count
```

---

## 진단 도구 (v2.1.3+)

`diagnose.sh`는 **read-only** 진단입니다. flag/counter/lock/log/settings를 한 번에 점검하고 현재 상태의 영향과 행동 옵션을 단정합니다. 어떤 파일도 mutate하지 않습니다.

```bash
bash .claude/hooks/diagnose.sh
```

출력 예시:
```
[등록 상태]   SessionStart/PostToolUse/Stop 등록 + 스크립트 존재
[PostToolUse] status: 🔴 DISABLED since 2026-05-12T11:55:50Z (3d ago)
              trigger-count: window_start=... count=4
              추정 원인: 응답 1회당 Edit/Write ≥4회 호출
[Stop]        continuation-plan.md: absent (idle 스킵 정상)
              만료된 lock: 0건 / 만료 임박: 0건
[영향 평가]   in_progress 1건 (lockedBy 0건) → 🟢 비활성 영향 없음
[행동 옵션]   [A] 그대로 / [B] 복구 / [C] 임계값 완화
```

## 자동 비활성화 진단 가이드

### 흔한 원인 TOP 3

기본 임계값 `10초/3회 초과`는 다음 패턴에서 쉽게 깨집니다.

1. **응답 1회에 Edit/Write 4회 이상 연속** — 멀티파일 리팩토링 시 가장 흔함
2. **MultiEdit 1회 + 후속 Edit 2~3회** — MultiEdit도 같은 매처에 잡힘
3. **자동화 스크립트 / 워크플로우 일괄 수정** — 짧은 시간 다발 호출

### `hook-trigger-count` 포맷 해석

파일 내용 예시: `1778586941 4`
- 첫 숫자 = 윈도우 시작 Unix epoch (UTC)
- 두 번째 숫자 = 누적 카운트
- 디코딩: `date -u -d @1778586941` 또는 `diagnose.sh`가 ISO8601로 변환해 표시

### 복구 결정 트리

```
현재 in_progress Task 중 lockedBy 설정된 게 있나?
├─ 없음 → 영향 0. 복구 불필요 (그대로 진행 가능)
└─ 있음 → 작업 예상 시간이 10분 초과 예정?
          ├─ 아니오 → 그대로 가능 (stop.sh가 만료된 lock만 해제, 단기 작업은 무영향)
          └─ 예    → 복구 권장 (heartbeat 갱신으로 lock 강제 해제 방지)
                    또는 임계값 완화 (CCK_HOOK_THRESHOLD=8 등)
```

`diagnose.sh`가 위 트리를 자동 판정해서 `[영향 평가]` 섹션에 결론을 출력합니다.

### Stop 부재 ≠ 미동작

`continuation-plan.md`가 없는 건 **Stop 미동작이 아니라** `workflowState=idle` 또는 `in_progress=0건` 시 의도적 스킵의 결과입니다. Stop 실제 동작을 확인하려면:

```bash
# 능동 검증 (mutate 가능 — 만료된 lock이 있다면 해제됨)
echo '{"stop_hook_active": false}' | bash .claude/hooks/stop.sh

# 또는 read-only로 만료 후보만 확인
bash .claude/hooks/diagnose.sh  # [Stop] 섹션
```

### 임계값 권장값

| 사용 패턴 | `CCK_HOOK_THRESHOLD` | 비고 |
|----------|---------------------:|------|
| 단독 작업, 멀티파일 흔함 | 8 | 응답당 Edit 다수 일반적 |
| 팀 작업, 동시 세션 운용 | 3 (기본) | TFT R1/R2 권장값 |
| 자동화 스크립트 다발 | flag 영구화 | `touch .claude/state/hook-disabled.flag` |

영구 적용은 `.claude/settings.json`의 hook 정의에 `env`를 추가하거나, shell rc 파일에 export하세요.

## 디버깅

### 로그 위치

- **hook-errors.log**: `.claude/state/hook-errors.log` — 훅 실패 append (비블로킹 에러 포함)
- **continuation-plan.md**: `.claude/state/continuation-plan.md` — Stop 훅이 주기 갱신 (디바운스 60s)

### 수동 실행

```bash
# SessionStart 시뮬레이션
echo '{}' | bash .claude/hooks/session-start.sh

# Stop 재귀 방지 확인
echo '{"stop_hook_active": true}' | bash .claude/hooks/stop.sh
# → 즉시 exit 0, 출력 없음

# Stop 정상 발동
echo '{"stop_hook_active": false}' | bash .claude/hooks/stop.sh
```

### 훅 일괄 비활성화

긴급 상황에서 훅을 멈춰야 할 때:

```bash
# 1. 자동 비활성화 플래그 (PostToolUse 수동 정지)
touch .claude/state/hook-disabled.flag

# 2. 전체 비활성화 (Claude Code 전역)
# settings.json에 "disableAllHooks": true 추가
```

---

## 동시성 — 워크트리 race 대응 (R5)

두 워크트리에서 동시에 `.claude/state/*.json`을 갱신하는 시나리오:

- **필수 규약**: `.claude/state/` 아래 JSON은 **반드시** `atomic_write` helper (`lib/atomic-write.sh`)를 통해서만 수정. 직접 리디렉션(`echo "..." > file.json`)이나 미-helper 경유 쓰기는 **금지** — flock 락을 우회하여 다른 writer와 race 발생.
- flock 가용 환경은 배타 잠금, 미지원 환경은 `mkdir` 뮤텍스 폴백. producer는 target을 인자로 받아 stdin으로 읽고 tmp 파일에 쓴 뒤 원자적 rename.
- **사용법**:
  ```bash
  source "$(dirname "$0")/lib/atomic-write.sh"
  atomic_write .claude/state/backlog.json \
    jq '.currentTask.lockedAt = "..."' .claude/state/backlog.json
  ```

---

## 회귀 테스트 (`tests/`)

TFT §4 실패 시나리오 6건을 자동 검증. CI(`.github/workflows/hook-tests.yml`)에서 shellcheck + `bash -n` + HI-04 자가 검사 + 전체 테스트가 실행됩니다.

```bash
bash .claude/hooks/tests/run-all.sh           # 전체
bash .claude/hooks/tests/test-stop-recursion.sh  # 개별
```

커버: 재귀 방지, jq/git 미설치, 워크트리 동시 write(flock), 만료 lock 해제, continuation-plan 디바운스/idle 스킵, develop 미반영 워크트리 claim 감지(이중 claim/자기 제외/stale 무시), HI-04 체커 자체, **머지 게이트(실제 backlog shape의 step.prNumber join 차단/통과·우회·비활성·fail-open·PR번호 추출 견고성 — `test-pre-tool-use-merge-gate.sh` 19 assertion)**.

---

## 참고

- [Claude Code 공식 훅 문서](https://docs.anthropic.com/claude-code) — 이벤트 종류, stdin JSON 스키마, exit code 의미
- `docs/v2/phase-1-tft-analysis.md` §1 — 네이티브 스펙 조사 결과
- `docs/v2/phase-1-hooks.md` — Phase 1 상위 계획
