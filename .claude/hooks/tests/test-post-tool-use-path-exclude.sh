#!/usr/bin/env bash
# test-post-tool-use-path-exclude.sh — 1단계 경로 제외 방어 (R1)
#
# .claude/state/* / .claude/temp/* 파일 경로 수신 시 heartbeat 갱신 없이 즉시 exit 0.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "post-tool-use.sh 1단계 경로 제외"

SANDBOX="$(mk_sandbox)"
# post-tool-use.sh 심볼릭 링크는 mk_sandbox가 걸지 않으므로 별도 연결
ln -s "$HOOK_DIR/post-tool-use.sh" "$SANDBOX/.claude/hooks/post-tool-use.sh"
trap 'rm -rf "$SANDBOX"' EXIT

BACKLOG="$SANDBOX/.claude/state/backlog.json"
SID="test-session-path"
OLD_LOCKED_AT="2020-01-01T00:00:00Z"
cat > "$BACKLOG" <<EOF
{
  "workflowState": "active",
  "tasks": {
    "T1": {"id": "T1", "status": "in_progress", "lockedAt": "$OLD_LOCKED_AT", "lockedBy": "$SID"}
  }
}
EOF

fail=0

run_hook() {
  local file_path="$1"
  (cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
    bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
    <<<"{\"session_id\":\"$SID\",\"tool_input\":{\"file_path\":\"$file_path\"}}" \
    >/dev/null 2>&1)
}

# 상대 경로 .claude/state/...
run_hook ".claude/state/backlog.json"
t1_after="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
assert_eq "$OLD_LOCKED_AT" "$t1_after" "상대 경로 .claude/state/ 제외 → lockedAt 미갱신" || fail=$((fail + 1))

# 절대 경로 /some/abs/path/.claude/state/...
run_hook "$SANDBOX/.claude/state/something.json"
t1_after="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
assert_eq "$OLD_LOCKED_AT" "$t1_after" "절대 경로 .claude/state/ 제외 → lockedAt 미갱신" || fail=$((fail + 1))

# .claude/temp/ 경로
run_hook ".claude/temp/scratch.md"
t1_after="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
assert_eq "$OLD_LOCKED_AT" "$t1_after" ".claude/temp/ 제외 → lockedAt 미갱신" || fail=$((fail + 1))

# 대조군: 일반 소스 파일 → heartbeat 갱신됨
run_hook "src/foo.kt"
t1_after="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
if [ "$t1_after" != "$OLD_LOCKED_AT" ] && [ "$t1_after" != "null" ]; then
  echo "  ✓ 일반 소스 파일 → lockedAt 갱신됨 (now=$t1_after)"
else
  echo "  ✗ 일반 소스 파일에서 lockedAt 갱신 안 됨: $t1_after" >&2
  fail=$((fail + 1))
fi

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
