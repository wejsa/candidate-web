#!/usr/bin/env bash
# test-stop-recursion.sh — TFT §4 #5: stop_hook_active=true → 즉시 exit 0

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "stop.sh 재귀 방지"

SANDBOX="$(mk_sandbox)"
trap 'rm -rf "$SANDBOX"' EXIT

fail=0

# 1. stop_hook_active=true → 즉시 exit 0, 출력 없음
output="$(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/stop.sh" <<< '{"stop_hook_active": true}' 2>&1)"
rc=$?
assert_eq 0 "$rc" "exit code 0" || fail=$((fail + 1))
assert_eq "" "$output" "no stdout/stderr output" || fail=$((fail + 1))

# 2. stop_hook_active=false → 정상 진행 (idle이라 조용히 exit 0)
printf '{"workflowState":"idle","tasks":[]}' > "$SANDBOX/.claude/state/backlog.json"
output="$(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/stop.sh" <<< '{"stop_hook_active": false}' 2>&1)"
rc=$?
assert_eq 0 "$rc" "exit code 0 (non-recursive)" || fail=$((fail + 1))

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
