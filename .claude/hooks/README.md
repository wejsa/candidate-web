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
├── session-start.sh              SessionStart: git sync + 상태 로드
├── stop.sh                       Stop: 만료 잠금 해제 + continuation-plan 갱신
└── post-tool-use.sh              PostToolUse: lockedAt heartbeat + 3단계 무한 루프 방어
```

---

## 비블로킹 작성 규칙 (중요)

훅 스크립트는 **Claude 세션을 절대 차단하지 않아야** 합니다. 다음 규칙을 지키세요.

| 금지 | 이유 | 대안 |
|------|------|------|
| `exit 2` | Claude Code는 exit 2를 "tool 호출 블록" 시그널로 해석 — 세션 흐름 차단 | 모든 에러 경로 `exit 0` + stderr 로그 |
| `set -e` (단독) | 중간 명령어 실패가 세션 차단으로 전파 | `... \|\| true` 또는 개별 체크 + `exit 0` |
| `set -u` / `set -o pipefail` | 미정의 변수/파이프 실패가 비의도적 차단 유발 | 명시적 조건 체크 |
| 대화형 프롬프트 유발 명령 | `git pull`(HTTPS credential), `ssh`, `sudo` 등이 터미널에서 입력을 대기 → 사용자 터미널이 hang | 훅 초반에 `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=/bin/true`, `GCM_INTERACTIVE=never` export + 필요 시 `exec 0</dev/null` |

**HI-04** (Phase 1 Step 5) 정적 검사로 위 규칙 위반을 자동 탐지합니다.

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

### SessionStart (`session-start.sh`)

**발동 시점**: Claude Code 세션 시작 시 1회
**timeout**: 30초
**동작**:
1. git sync (워크트리면 `git fetch + merge --ff-only`, 일반 클론이면 `git pull --ff-only`)
2. `.claude/state/continuation-plan.md` 존재 시 stdout 출력
3. `.claude/state/backlog.json`의 `in_progress` Task 목록 안내

**graceful skip 시나리오**: git 미설치, jq 미설치, 비-git 디렉토리 → 경고 로그 후 계속.

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
**동작**: 현재 세션이 `lockedBy`로 소유한 `in_progress` Task의 `lockedAt`을 현재 시각으로 갱신(heartbeat). stop.sh 만료 감지(10분 TTL)와 연동.

**3단계 무한 루프 방어** (TFT R1/R2):

| 단계 | 트리거 | 동작 |
|------|--------|------|
| 0 | `hook-disabled.flag` 존재 | 즉시 exit 0 |
| 1 | `file_path`가 `.claude/state/*` 또는 `.claude/temp/*` | 즉시 exit 0 (네이티브 path 필터 부재 — 스크립트 레벨) |
| 2 | 세션별 락(`$TMPDIR/ack-hook-<sid>.lock`) 존재 | 재진입으로 판단, 즉시 exit 0. 정상 경로는 `trap EXIT`로 정리 |
| 3 | 10초 윈도우 내 3회 초과 | `hook-disabled.flag` 생성 + stderr 경고 로그 |

**graceful skip**: jq 미설치, stdin 비어있음, 소유 Task 없음 → 쓰기 없이 exit 0.

**수동 복구**: 자동 비활성화 발동 시 원인 점검 후 플래그 삭제:
```bash
rm .claude/state/hook-disabled.flag
rm .claude/state/hook-trigger-count
```

---

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

커버: 재귀 방지, jq/git 미설치, 워크트리 동시 write(flock), 만료 lock 해제, continuation-plan 디바운스/idle 스킵, HI-04 체커 자체.

---

## 참고

- [Claude Code 공식 훅 문서](https://docs.anthropic.com/claude-code) — 이벤트 종류, stdin JSON 스키마, exit code 의미
- `docs/v2/phase-1-tft-analysis.md` §1 — 네이티브 스펙 조사 결과
- `docs/v2/phase-1-hooks.md` — Phase 1 상위 계획
