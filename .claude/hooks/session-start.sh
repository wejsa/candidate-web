#!/usr/bin/env bash
# session-start.sh — Phase 1 Step 2: SessionStart 훅
#
# 목적:
#   1. git sync (워크트리 감지 후 fetch+merge 또는 pull)
#   2. .claude/state/continuation-plan.md 존재 시 stdout 출력
#   3. backlog.json의 in_progress Task 목록 안내
#   4. develop 미반영 워크트리 claim 감지 (다중 워크트리 동시 선택 안전장치)
#      — 워크트리 모드 claim은 worktree-<name> 브랜치에 먼저 박힌 뒤 develop으로
#        전파되므로(CLAUDE.md 워크트리 프로토콜 "상태 파일 반영" 행), develop tip만
#        보는 1·3단계는 그 전파 지연 윈도우의 claim을 못 본다. 여기서 직접 스캔한다.
#
# 작성 규칙 (R4):
#   - set -e 금지. exit 2 금지. 모든 실패 경로 exit 0 (비블로킹).
#   - 치명적 에러는 stderr + .claude/state/hook-errors.log 기록 후 exit 0.

# shellcheck disable=SC2015

HOOK_NAME="session-start"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

# 훅은 비대화형 — git이 credential/확인 프롬프트를 띄우지 못하도록 강제.
# (HTTPS remote + credential manager 미캐시 상태에서 터미널 멈춤 방지)
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
export GCM_INTERACTIVE=never
# 자식 프로세스 stdin 차단 (이중 방어)
exec 0</dev/null

STATE_DIR=".claude/state"
ERROR_LOG="$STATE_DIR/hook-errors.log"
CONT_PLAN="$STATE_DIR/continuation-plan.md"
BACKLOG="$STATE_DIR/backlog.json"

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

log_err() {
  local msg="$1"
  printf '[%s] [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$HOOK_NAME" "$msg" >> "$ERROR_LOG" 2>/dev/null || true
  printf '⚠️  [%s] %s\n' "$HOOK_NAME" "$msg" >&2
}

# ── 1. git sync ───────────────────────────────────────────────
if command -v git >/dev/null 2>&1 && { [ -d .git ] || git rev-parse --git-dir >/dev/null 2>&1; }; then
  printf '🪝 [session-start] git sync…\n'

  GIT_DIR_RESOLVED="$(git rev-parse --git-dir 2>/dev/null || true)"
  GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(detached)')"

  # 워크트리면 common-dir과 git-dir이 다름
  IS_WORKTREE=0
  if [ -n "$GIT_DIR_RESOLVED" ] && [ -n "$GIT_COMMON_DIR" ]; then
    ABS_GIT="$(cd "$GIT_DIR_RESOLVED" 2>/dev/null && pwd || echo "$GIT_DIR_RESOLVED")"
    ABS_COMMON="$(cd "$GIT_COMMON_DIR" 2>/dev/null && pwd || echo "$GIT_COMMON_DIR")"
    [ "$ABS_GIT" != "$ABS_COMMON" ] && IS_WORKTREE=1
  fi

  BEFORE_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"

  UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  SYNC_ATTEMPTED=0
  if [ -z "$UPSTREAM" ]; then
    printf '  upstream 미설정 — sync 스킵 (%s)\n' "$BRANCH"
  elif [ "$IS_WORKTREE" -eq 1 ]; then
    SYNC_ATTEMPTED=1
    git fetch --quiet origin 2>/dev/null || log_err "git fetch 실패 (계속 진행)"
    git merge --ff-only "$UPSTREAM" 2>/dev/null || log_err "ff-only merge 실패 — 수동 확인 필요 ($UPSTREAM)"
  else
    SYNC_ATTEMPTED=1
    git pull --ff-only --quiet 2>/dev/null || log_err "git pull 실패 (계속 진행)"
  fi

  if [ "$SYNC_ATTEMPTED" -eq 1 ]; then
    AFTER_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
    if [ -n "$BEFORE_SHA" ] && [ "$BEFORE_SHA" != "$AFTER_SHA" ]; then
      NEW_COUNT="$(git rev-list --count "$BEFORE_SHA..$AFTER_SHA" 2>/dev/null || echo '?')"
      printf '✓ 동기화 완료 (+%s commits, %s)\n' "$NEW_COUNT" "$BRANCH"
    else
      printf '✓ 최신 상태 (%s)\n' "$BRANCH"
    fi
  fi
else
  log_err "git 미설치 또는 비-git 디렉토리 — sync 스킵"
fi

# ── 2. continuation-plan.md 출력 ─────────────────────────────
if [ -f "$CONT_PLAN" ]; then
  printf '\n📋 continuation-plan.md:\n'
  printf -- '─────────────────────────────────────\n'
  cat "$CONT_PLAN" 2>/dev/null | head -100
  printf -- '─────────────────────────────────────\n'
fi

# ── 3. in_progress Task 안내 ─────────────────────────────────
if [ -f "$BACKLOG" ] && command -v jq >/dev/null 2>&1; then
  IN_PROGRESS="$(jq -r '[.tasks[]? | select(.status == "in_progress")] | length' "$BACKLOG" 2>/dev/null || echo 0)"
  if [ "$IN_PROGRESS" != "0" ] && [ "$IN_PROGRESS" != "" ]; then
    printf '\n🔵 진행 중 Task (%s건):\n' "$IN_PROGRESS"
    jq -r '.tasks[]? | select(.status == "in_progress") | "  - \(.id): \(.title // .subject // "(제목 없음)")"' "$BACKLOG" 2>/dev/null || true
  fi
elif [ -f "$BACKLOG" ]; then
  # jq 미설치 graceful skip
  log_err "jq 미설치 — backlog 파싱 스킵"
fi

# ── 4. develop 미반영 워크트리 claim 감지 ─────────────────────
# worktree-<name> 브랜치에는 in_progress인데 develop(현재 동기화된 backlog)에는
# 아직 todo로 남아있는 Task = 전파 지연 윈도우의 in-flight claim. 직접 경고한다.
# (현재 세션 자신의 브랜치 제외. develop에서 이미 in_progress면 정상 전파된 것이므로
#  경고하지 않고, done/merged면 머지 후 잔존 브랜치의 stale claim이므로 무시한다.)
if [ -f "$BACKLOG" ] && command -v jq >/dev/null 2>&1 && command -v git >/dev/null 2>&1 \
   && { [ -d .git ] || git rev-parse --git-dir >/dev/null 2>&1; }; then

  # 워크트리 브랜치 원격 추적 ref만 타깃 최신화 (비블로킹, 모드 무관)
  git fetch --quiet origin '+refs/heads/worktree-*:refs/remotes/origin/worktree-*' 2>/dev/null || true

  CUR_BRANCH="${BRANCH:-}"
  CLAIMS=""   # 각 줄: <ref>\t<taskId>\t<assignee>
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    [ "$ref" = "origin/$CUR_BRANCH" ] && continue   # 자기 브랜치 제외
    bjson="$(git show "$ref:.claude/state/backlog.json" 2>/dev/null || true)"
    [ -z "$bjson" ] && continue
    while IFS= read -r ln; do
      [ -z "$ln" ] && continue
      CLAIMS+="${ref}"$'\t'"${ln}"$'\n'
    done < <(printf '%s' "$bjson" \
      | jq -r '.tasks[]? | select(.status=="in_progress") | "\(.id)\t\(.assignee // "?")"' 2>/dev/null || true)
  done < <(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/worktree-*' 2>/dev/null || true)

  if [ -n "$CLAIMS" ]; then
    ALERTS=""
    while IFS= read -r tid; do
      [ -z "$tid" ] && continue
      # develop 상태: 미존재 시 todo로 간주 (워크트리에만 있는 신규 claim)
      dev_status="$(jq -r --arg id "$tid" 'first(.tasks[]? | select(.id==$id) | .status) // "todo"' "$BACKLOG" 2>/dev/null || echo todo)"
      [ "$dev_status" != "todo" ] && continue
      bset="$(printf '%s' "$CLAIMS" | awk -F'\t' -v id="$tid" '$2==id{print $1}' | sort -u)"
      nb="$(printf '%s\n' "$bset" | awk 'NF{c++} END{print c+0}')"
      branches="$(printf '%s' "$bset" | paste -sd',' -)"
      asg="$(printf '%s' "$CLAIMS" | awk -F'\t' -v id="$tid" '$2==id{print $3; exit}')"
      if [ "$nb" -gt 1 ]; then
        ALERTS+="  🔴 ${tid} — 복수 워크트리 동시 claim (${branches}) · develop=todo"$'\n'
      else
        ALERTS+="  🔶 ${tid} — ${branches} claim (assignee: ${asg}) · develop=todo"$'\n'
      fi
    done < <(printf '%s' "$CLAIMS" | awk -F'\t' 'NF>=2{print $2}' | sort -u)

    if [ -n "$ALERTS" ]; then
      printf '\n🔶 develop 미반영 워크트리 claim 감지:\n'
      printf '%s' "$ALERTS"
      printf '  → 시작 전 해당 워크트리에서 진행 중인지 직접 확인 권장 (claim이 아직 develop SSOT에 없음)\n'
    fi
  fi
fi

exit 0
