#!/usr/bin/env bash
# atomic-write.sh — Phase 1 Step 2: 원자적 파일 쓰기 helper (R5 대응)
#
# 워크트리 2개가 동시에 .claude/state/*.json을 갱신할 때 race condition 방지.
# flock이 가용하면 flock 기반 배타 잠금, 미지원 환경은 mkdir 뮤텍스로 폴백.
#
# 사용법:
#   source "$(dirname "${BASH_SOURCE[0]}")/atomic-write.sh"
#   atomic_write <target-path> <content-producer-command...>
#     예: atomic_write .claude/state/backlog.json jq '.currentTask.lockedAt = now' .claude/state/backlog.json
#
# 규약:
#   - 실패 시에도 exit 0 (비블로킹). 에러는 stderr + hook-errors.log.
#   - 대상 파일 부재 시 content-producer가 자체 처리해야 함.

ACK_HOOK_ERROR_LOG="${ACK_HOOK_ERROR_LOG:-.claude/state/hook-errors.log}"

_ack_log_error() {
  local msg="$1"
  mkdir -p "$(dirname "$ACK_HOOK_ERROR_LOG")" 2>/dev/null || return 0
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$msg" >> "$ACK_HOOK_ERROR_LOG" 2>/dev/null || true
}

atomic_write() {
  local target="$1"; shift
  if [ -z "$target" ] || [ $# -eq 0 ]; then
    _ack_log_error "atomic_write: invalid args (target=$target)"
    return 0
  fi
  local dir; dir="$(dirname "$target")"
  mkdir -p "$dir" 2>/dev/null || { _ack_log_error "atomic_write: mkdir failed: $dir"; return 0; }

  local tmp="${target}.tmp.$$"
  local lock="${target}.lock"

  _ack_do_write() {
    if "$@" > "$tmp" 2>/dev/null; then
      mv -f "$tmp" "$target" 2>/dev/null || {
        _ack_log_error "atomic_write: mv failed: $target"
        rm -f "$tmp" 2>/dev/null
        return 0
      }
    else
      _ack_log_error "atomic_write: producer failed: $*"
      rm -f "$tmp" 2>/dev/null
    fi
    return 0
  }

  if command -v flock >/dev/null 2>&1; then
    (
      exec 9> "$lock"
      if flock -x -w 5 9; then
        _ack_do_write "$@"
      else
        _ack_log_error "atomic_write: flock timeout: $lock"
      fi
    )
  else
    # mkdir 뮤텍스 폴백 (macOS 일부 환경 대비)
    local mutex="${target}.mutex.d"
    local waited=0
    while ! mkdir "$mutex" 2>/dev/null; do
      waited=$((waited + 1))
      if [ "$waited" -ge 50 ]; then
        _ack_log_error "atomic_write: mkdir mutex timeout: $mutex"
        return 0
      fi
      sleep 0.1
    done
    _ack_do_write "$@"
    rmdir "$mutex" 2>/dev/null || true
  fi
  return 0
}
