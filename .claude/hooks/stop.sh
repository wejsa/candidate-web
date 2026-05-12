#!/usr/bin/env bash
# stop.sh — Phase 1 Step 2: Stop 훅 (응답 완료 시마다 발동)
#
# 목적:
#   1. stop_hook_active=true 수신 시 즉시 exit 0 (공식 재귀 방지)
#   2. 만료된 Task 잠금 해제 (매 턴 수행 OK)
#   3. continuation-plan.md 조건부 갱신:
#      - 60초 이내 갱신됐으면 스킵 (디바운스)
#      - workflowState=idle 또는 활성 Task 없으면 스킵
#      - 그 외: 원자적 temp write + rename
#
# 작성 규칙 (R4):
#   - set -e 금지. exit 2 금지. 모든 실패 경로 exit 0.
#   - stderr 출력 자제 (매 턴 발동 → 노이즈).

HOOK_NAME="stop"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

# 훅은 비대화형 — 어떠한 자식 프로세스도 프롬프트를 띄우지 못하도록.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
export GCM_INTERACTIVE=never

STATE_DIR=".claude/state"
ERROR_LOG="$STATE_DIR/hook-errors.log"
CONT_PLAN="$STATE_DIR/continuation-plan.md"
BACKLOG="$STATE_DIR/backlog.json"
DEBOUNCE_SECONDS=60

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

log_err() {
  local msg="$1"
  printf '[%s] [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$HOOK_NAME" "$msg" >> "$ERROR_LOG" 2>/dev/null || true
}

# ── stdin JSON 수신 (timeout 1초로 hang 방지) ────────────────
INPUT=""
if [ ! -t 0 ]; then
  INPUT="$(timeout 1 cat 2>/dev/null || true)"
fi
# stdin 소비 후 자식 프로세스 stdin 차단 (session-start.sh와 일관)
exec 0</dev/null

# ── 0. 공식 재귀 방지: stop_hook_active=true ─────────────────
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  STOP_ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
  if [ "$STOP_ACTIVE" = "true" ]; then
    exit 0
  fi
fi

# jq 없으면 아래 로직 전부 스킵 (graceful)
if ! command -v jq >/dev/null 2>&1; then
  log_err "jq 미설치 — stop 로직 스킵"
  exit 0
fi

# ── 1. 만료 잠금 해제 (매 턴 OK) ────────────────────────────
# backlog.json에 lockedAt 필드가 있고 heartbeat 만료된 Task의 lock 해제
if [ -f "$BACKLOG" ]; then
  # shellcheck source=./lib/atomic-write.sh
  source "$(dirname "$0")/lib/atomic-write.sh" 2>/dev/null || log_err "atomic-write.sh 로드 실패"

  NOW_EPOCH="$(date -u +%s)"
  # 만료 기준: lockedAt으로부터 10분 (600초) 경과
  EXPIRY_SECONDS=600

  if command -v atomic_write >/dev/null 2>&1; then
    # 만료된 lock이 있는지 먼저 확인 (매 턴 쓰기 방지)
    HAS_EXPIRED="$(jq --argjson now "$NOW_EPOCH" --argjson ttl "$EXPIRY_SECONDS" '
      [.tasks[]? | select(
        (.lockedAt // "") != "" and
        ((.lockedAt | fromdateiso8601?) // 0) < ($now - $ttl)
      )] | length > 0
    ' "$BACKLOG" 2>/dev/null || echo false)"

    if [ "$HAS_EXPIRED" = "true" ]; then
      atomic_write "$BACKLOG" jq \
        --argjson now "$NOW_EPOCH" \
        --argjson ttl "$EXPIRY_SECONDS" \
        '.tasks |= map(
          if (.lockedAt // "") != "" and
             ((.lockedAt | fromdateiso8601?) // 0) < ($now - $ttl)
          then . + {lockedAt: null, lockedBy: null}
          else . end
        )' "$BACKLOG"
    fi
  fi
fi

# ── 2. continuation-plan 조건부 갱신 ─────────────────────────
# 2-1. 디바운스: 60초 이내 갱신됐으면 스킵
if [ -f "$CONT_PLAN" ]; then
  PLAN_MTIME="$(stat -c %Y "$CONT_PLAN" 2>/dev/null || stat -f %m "$CONT_PLAN" 2>/dev/null || echo 0)"
  NOW_EPOCH="${NOW_EPOCH:-$(date -u +%s)}"
  AGE=$((NOW_EPOCH - PLAN_MTIME))
  if [ "$AGE" -lt "$DEBOUNCE_SECONDS" ]; then
    exit 0
  fi
fi

# 2-2. 활성 Task 없으면 스킵 (workflowState=idle 또는 in_progress 0건)
if [ -f "$BACKLOG" ]; then
  WORKFLOW_STATE="$(jq -r '.workflowState // "idle"' "$BACKLOG" 2>/dev/null || echo idle)"
  IN_PROGRESS_COUNT="$(jq -r '[.tasks[]? | select(.status == "in_progress")] | length' "$BACKLOG" 2>/dev/null || echo 0)"
  if [ "$WORKFLOW_STATE" = "idle" ] || [ "$IN_PROGRESS_COUNT" = "0" ]; then
    exit 0
  fi

  # 2-3. 원자적 continuation-plan 생성
  ACTIVE_TASKS="$(jq -r '.tasks[]? | select(.status == "in_progress") | "- \(.id): \(.title // .subject // "(제목 없음)")"' "$BACKLOG" 2>/dev/null || true)"
  TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  TMP_PLAN="${CONT_PLAN}.tmp.$$"
  {
    printf '# 이어서 작업\n\n'
    printf '> 자동 생성: %s\n\n' "$TS"
    printf '## 진행 중 Task\n\n'
    printf '%s\n' "$ACTIVE_TASKS"
    printf '\n## 재개 방법\n\n'
    # printf: '-' 로 시작하는 포맷은 옵션으로 해석되므로 %s 포맷 필수
    printf '%s\n' '- `docs/v2/phase-1-plan.md` 혹은 해당 계획서 확인'
    printf '%s\n' '- `/skill-impl` 또는 `/skill-plan`으로 복귀'
  } > "$TMP_PLAN" 2>/dev/null && mv -f "$TMP_PLAN" "$CONT_PLAN" 2>/dev/null || {
    log_err "continuation-plan 쓰기 실패"
    rm -f "$TMP_PLAN" 2>/dev/null
  }
fi

exit 0
