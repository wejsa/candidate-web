#!/usr/bin/env bash
# _lib.sh — 훅 테스트 공용 헬퍼

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HOOK_DIR="$REPO_ROOT/.claude/hooks"

# 격리된 fixture 디렉토리 생성 (.claude/state/만 있는 가짜 프로젝트)
# 사용: SANDBOX=$(mk_sandbox); trap "rm -rf $SANDBOX" EXIT
mk_sandbox() {
  local dir
  dir="$(mktemp -d -t ack-hook-test.XXXXXX)"
  mkdir -p "$dir/.claude/state" "$dir/.claude/hooks/lib"
  # 훅 스크립트 심볼릭 링크로 재사용 (실제 대상 검증)
  ln -s "$HOOK_DIR/session-start.sh" "$dir/.claude/hooks/session-start.sh"
  ln -s "$HOOK_DIR/stop.sh" "$dir/.claude/hooks/stop.sh"
  ln -s "$HOOK_DIR/lib/atomic-write.sh" "$dir/.claude/hooks/lib/atomic-write.sh"
  printf '%s\n' "$dir"
}

assert_eq() {
  local expected="$1" actual="$2" label="${3:-}"
  if [ "$expected" != "$actual" ]; then
    printf '  ✗ %s — expected=%q actual=%q\n' "$label" "$expected" "$actual" >&2
    return 1
  fi
  printf '  ✓ %s\n' "$label"
  return 0
}

assert_contains() {
  local haystack="$1" needle="$2" label="${3:-}"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf '  ✓ %s\n' "$label"
    return 0
  fi
  printf '  ✗ %s — %q not in output\n' "$label" "$needle" >&2
  return 1
}

assert_file_exists() {
  local path="$1" label="${2:-file}"
  if [ -f "$path" ]; then
    printf '  ✓ %s (%s)\n' "$label" "$path"
    return 0
  fi
  printf '  ✗ %s — %s missing\n' "$label" "$path" >&2
  return 1
}

assert_file_not_exists() {
  local path="$1" label="${2:-file}"
  if [ ! -f "$path" ]; then
    printf '  ✓ %s\n' "$label"
    return 0
  fi
  printf '  ✗ %s — %s should not exist\n' "$label" "$path" >&2
  return 1
}

print_header() {
  printf '\n── %s ──\n' "$1"
}
