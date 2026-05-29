#!/usr/bin/env bash
# post-tool-use.sh — Phase 1 Step 3: PostToolUse 훅 (Edit|Write 매처)
#
# 목적:
#   Write/Edit 도구 호출 후, 현재 세션이 소유한 in_progress Task의
#   lockedAt heartbeat를 갱신하여 stop.sh의 만료 감지와 연동한다.
#
# 3단계 무한 루프 방어 (TFT R1, R2):
#   0. 자동 비활성화 플래그(hook-disabled.flag) 존재 시 즉시 종료
#   1. 경로 제외: file_path가 .claude/state/* 또는 .claude/temp/* → exit 0
#      (네이티브 path 필터 부재 — 스크립트 레벨에서 처리)
#   2. 파일 락: 세션별 락 파일이 존재하면 재진입 판단, exit 0
#   3. 트리거 카운터: 10초 윈도우 내 3회 초과 → hook-disabled.flag 생성 + 경고
#
# 작성 규칙 (R4):
#   - set -e 금지. exit 2 금지. 모든 실패 경로 exit 0 (비블로킹).
#   - stderr 출력 자제 (Write/Edit마다 발동 → 노이즈 방지). 단, 자동 비활성화 시에는 경고.

# shellcheck disable=SC2015

HOOK_NAME="post-tool-use"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

# 훅은 비대화형 — 자식 프로세스가 프롬프트를 띄우지 못하도록 (session-start와 일관).
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
export GCM_INTERACTIVE=never

STATE_DIR=".claude/state"
ERROR_LOG="$STATE_DIR/hook-errors.log"
BACKLOG="$STATE_DIR/backlog.json"
DISABLE_FLAG="$STATE_DIR/hook-disabled.flag"
COUNTER_FILE="$STATE_DIR/hook-trigger-count"
INIT_FLAG="$STATE_DIR/init-in-progress.flag"
INIT_FLAG_TTL_SECONDS=3600  # 마커 미회수(SKILL 비정상 종료) 대비 1시간 후 stale로 간주

# 임계값/윈도우 외부화 (v2.1.3): 멀티파일 Edit이 잦은 단독 작업자가 자체적으로 완화 가능.
# 기본값은 TFT R1/R2 권장값 그대로 유지 → 미설정 시 회귀 0.
# 비숫자/0 이하 입력은 무시하고 기본값 사용.
TRIGGER_WINDOW_SECONDS="${CCK_HOOK_WINDOW_SEC:-10}"
TRIGGER_MAX="${CCK_HOOK_THRESHOLD:-3}"
case "$TRIGGER_WINDOW_SECONDS" in ''|*[!0-9]*) TRIGGER_WINDOW_SECONDS=10 ;; esac
case "$TRIGGER_MAX" in ''|*[!0-9]*) TRIGGER_MAX=3 ;; esac
[ "$TRIGGER_WINDOW_SECONDS" -lt 1 ] 2>/dev/null && TRIGGER_WINDOW_SECONDS=10
[ "$TRIGGER_MAX" -lt 1 ] 2>/dev/null && TRIGGER_MAX=3

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

log_err() {
  local msg="$1"
  printf '[%s] [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$HOOK_NAME" "$msg" >> "$ERROR_LOG" 2>/dev/null || true
}

# ── 0단계: 자동 비활성화 플래그 ──────────────────────
if [ -f "$DISABLE_FLAG" ]; then
  exit 0
fi

# ── 0-A단계: init/onboard 트리거 보호 마커 (v2.2.0) ─────
# skill-init/onboard 트랜잭션 동안은 초기 셋업 폭주(다수 Write)가 정상이므로
# 카운터 진입 자체를 차단하여 false-positive 자동 비활성화 방지.
# 마커는 SKILL이 시작 시 생성·종료 시 제거하지만, 비정상 종료 대비 TTL 자동 회수.
if [ -f "$INIT_FLAG" ]; then
  flag_mtime="$(stat -c %Y "$INIT_FLAG" 2>/dev/null || stat -f %m "$INIT_FLAG" 2>/dev/null || echo 0)"
  flag_age=$(( $(date -u +%s) - flag_mtime ))
  if [ "$flag_age" -lt "$INIT_FLAG_TTL_SECONDS" ] 2>/dev/null; then
    exit 0
  fi
  # stale 마커 (TTL 초과) — SKILL이 정리 못 하고 종료된 케이스. 자동 회수.
  rm -f "$INIT_FLAG" 2>/dev/null
  log_err "init-in-progress.flag stale 회수 (age=${flag_age}s > ${INIT_FLAG_TTL_SECONDS}s)"
fi

# jq 미설치 graceful skip
if ! command -v jq >/dev/null 2>&1; then
  log_err "jq 미설치 — heartbeat 스킵"
  exit 0
fi

# ── stdin JSON 수신 (timeout 1초) ───────────────────
INPUT=""
if [ ! -t 0 ]; then
  INPUT="$(timeout 1 cat 2>/dev/null || true)"
fi
exec 0</dev/null

if [ -z "$INPUT" ]; then
  exit 0
fi

FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo '')"
SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)"

# ── SESSION_ID 부재 시 조기 종료 (H005) ───────────────
# `nosession` 공유 락 시 다중 세션이 서로의 heartbeat를 차단 → stop.sh TTL 만료로
# 다른 세션 소유 Task가 강제 해제되는 간접 경로. session_id 미확인이면 heartbeat 자체 스킵.
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "nosession" ] || [ "$SESSION_ID" = "null" ]; then
  exit 0
fi

# ── 1단계: 경로 제외 ─────────────────────────────────
# 백슬래시 → `/`, `//+` → `/`, `/./` → `/` 정규화 후 상대/절대 경로 양쪽 매칭.
# (R1 방어 — `.claude//state/foo`, `./.claude/state/foo` 등 우회 차단)
FILE_PATH_NORM="$(printf '%s' "$FILE_PATH" | tr '\\' '/' | sed -e 's|//\+|/|g' -e 's|/\./|/|g')"
# 선행 `./` 제거 (상대 경로 정규화)
case "$FILE_PATH_NORM" in ./*) FILE_PATH_NORM="${FILE_PATH_NORM#./}" ;; esac
# symlink 정규화: realpath 존재 시 ./ 기준 상대 경로로 치환 (없으면 graceful skip)
if command -v realpath >/dev/null 2>&1 && [ -n "$FILE_PATH_NORM" ]; then
  REAL_REL="$(realpath --relative-to=. "$FILE_PATH_NORM" 2>/dev/null || true)"
  [ -n "$REAL_REL" ] && FILE_PATH_NORM="$REAL_REL"
fi
case "$FILE_PATH_NORM" in
  .claude/state/*|.claude/temp/*|*/.claude/state/*|*/.claude/temp/*)
    exit 0
    ;;
esac

# ── 3단계: 트리거 카운터 (락보다 먼저 — 폭주 시 락을 못 잡는 상태에서도 카운팅) ──
NOW_EPOCH="$(date -u +%s)"
WINDOW_START="$NOW_EPOCH"
COUNT=1
if [ -f "$COUNTER_FILE" ]; then
  read -r prev_start prev_count < "$COUNTER_FILE" 2>/dev/null || { prev_start=0; prev_count=0; }
  prev_start="${prev_start:-0}"
  prev_count="${prev_count:-0}"
  # 숫자 검증
  case "$prev_start" in ''|*[!0-9]*) prev_start=0 ;; esac
  case "$prev_count" in ''|*[!0-9]*) prev_count=0 ;; esac
  # sanity: 비현실적 값 (카운터 파일 오염/장시간 누적)은 리셋 (H006)
  [ "$prev_count" -gt 1000 ] && prev_count=0
  if [ "$((NOW_EPOCH - prev_start))" -le "$TRIGGER_WINDOW_SECONDS" ]; then
    WINDOW_START="$prev_start"
    COUNT=$((prev_count + 1))
  fi
fi
printf '%s %s\n' "$WINDOW_START" "$COUNT" > "$COUNTER_FILE" 2>/dev/null || true

if [ "$COUNT" -gt "$TRIGGER_MAX" ]; then
  touch "$DISABLE_FLAG" 2>/dev/null
  printf '⚠️  [%s] 10초 내 %s회 트리거 — 자동 비활성화됨. 확인 후 %s 삭제 후 재개하세요.\n' \
    "$HOOK_NAME" "$COUNT" "$DISABLE_FLAG" >&2
  log_err "자동 비활성화 발동 (count=$COUNT, window_start=$WINDOW_START)"
  exit 0
fi

# ── 2단계: 파일 락 재진입 방지 ───────────────────────
LOCK_DIR="${TMPDIR:-/tmp}"
[ -d "$LOCK_DIR" ] || LOCK_DIR="$STATE_DIR"
# 세션 ID에 경로 문자가 섞이지 않도록 안전화
SAFE_SID="$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9._-' '_')"
LOCK="$LOCK_DIR/ack-hook-${SAFE_SID}.lock"

if [ -e "$LOCK" ]; then
  exit 0
fi
# 락 획득 — 종료 시 반드시 정리
touch "$LOCK" 2>/dev/null || exit 0
trap 'rm -f "$LOCK" 2>/dev/null' EXIT

# ── 핵심: backlog.json lockedAt heartbeat 갱신 ───────
if [ -f "$BACKLOG" ]; then
  # shellcheck source=./lib/atomic-write.sh
  source "$(dirname "$0")/lib/atomic-write.sh" 2>/dev/null || {
    log_err "atomic-write.sh 로드 실패"
    exit 0
  }

  NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  # 세션이 소유한 in_progress Task 존재 여부 확인 (불필요한 쓰기 방지)
  HAS_OWNED="$(jq --arg sid "$SESSION_ID" '
    [.tasks[]? | select(.status == "in_progress" and (.lockedBy // "") == $sid)] | length > 0
  ' "$BACKLOG" 2>/dev/null || echo false)"

  if [ "$HAS_OWNED" = "true" ] && command -v atomic_write >/dev/null 2>&1; then
    # schema는 .tasks를 object(dict, key=Task ID)로 정의. jq `map(f)`는 array 변환 연산자이므로
    # dict에 적용하면 [{...},{...}]로 평탄화되어 키가 영구 손실됨. `with_entries(.value |= ...)`로
    # dict 의미를 유지하면서 값만 in-place 갱신. v1 array fixture에는 무동작(early skip)으로 안전.
    atomic_write "$BACKLOG" jq \
      --arg sid "$SESSION_ID" \
      --arg now "$NOW_ISO" \
      '.tasks |= with_entries(
        .value |= (
          if .status == "in_progress" and (.lockedBy // "") == $sid
          then . + {lockedAt: $now}
          else . end
        )
      )' "$BACKLOG"
  fi
fi

exit 0
