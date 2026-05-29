#!/usr/bin/env bash
# test-post-tool-use-heartbeat.sh — 정상 케이스: backlog.json lockedAt 갱신 + 무-heartbeat 시 쓰기 스킵

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "post-tool-use.sh heartbeat 갱신 + 대조군"

SANDBOX="$(mk_sandbox)"
ln -s "$HOOK_DIR/post-tool-use.sh" "$SANDBOX/.claude/hooks/post-tool-use.sh"
TMP_ISO="$(mktemp -d -t ack-post-tool-hb.XXXXXX)"
trap 'rm -rf "$SANDBOX" "$TMP_ISO"' EXIT

BACKLOG="$SANDBOX/.claude/state/backlog.json"
OWNER_SID="my-session"
OTHER_SID="someone-else"

cat > "$BACKLOG" <<EOF
{
  "workflowState": "active",
  "tasks": {
    "T1": {"id": "T1", "status": "in_progress", "lockedAt": "2020-01-01T00:00:00Z", "lockedBy": "$OWNER_SID"},
    "T2": {"id": "T2", "status": "in_progress", "lockedAt": "2020-01-01T00:00:00Z", "lockedBy": "$OTHER_SID"},
    "T3": {"id": "T3", "status": "completed", "lockedAt": "2020-01-01T00:00:00Z", "lockedBy": "$OWNER_SID"}
  }
}
EOF

fail=0

# 1) 소유한 세션이 호출 → T1만 heartbeat 갱신
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
  bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
  <<<"{\"session_id\":\"$OWNER_SID\",\"tool_input\":{\"file_path\":\"src/App.kt\"}}" \
  >/dev/null 2>&1)

t1="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
t2="$(jq -r '.tasks["T2"].lockedAt' "$BACKLOG")"
t3="$(jq -r '.tasks["T3"].lockedAt' "$BACKLOG")"

if [ "$t1" != "2020-01-01T00:00:00Z" ] && [ "$t1" != "null" ]; then
  echo "  ✓ T1 (owner+in_progress) lockedAt 갱신됨 → $t1"
else
  echo "  ✗ T1 갱신 실패: $t1" >&2
  fail=$((fail + 1))
fi
assert_eq "2020-01-01T00:00:00Z" "$t2" "T2 (다른 세션 소유) 미갱신" || fail=$((fail + 1))
assert_eq "2020-01-01T00:00:00Z" "$t3" "T3 (completed) 미갱신" || fail=$((fail + 1))

# 2) 소유 Task가 없는 세션 → 파일 쓰기 발생하지 않아야 함 (mtime 변화 없음)
# 락 파일 정리 후 실행
rm -f "$TMP_ISO"/*.lock 2>/dev/null
BEFORE_MTIME="$(stat -c %Y "$BACKLOG" 2>/dev/null || stat -f %m "$BACKLOG" 2>/dev/null || echo 0)"
sleep 1
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
  bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
  <<<"{\"session_id\":\"unknown-session\",\"tool_input\":{\"file_path\":\"src/App.kt\"}}" \
  >/dev/null 2>&1)
AFTER_MTIME="$(stat -c %Y "$BACKLOG" 2>/dev/null || stat -f %m "$BACKLOG" 2>/dev/null || echo 0)"
assert_eq "$BEFORE_MTIME" "$AFTER_MTIME" "소유 Task 없으면 backlog 쓰기 스킵 (mtime 불변)" || fail=$((fail + 1))

# 3) stdin JSON이 비어 있어도 graceful exit 0 (session-start 테스트가 아닌 post-tool-use에 대한 독립 검증)
rm -f "$TMP_ISO"/*.lock 2>/dev/null
if (cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
    bash "$SANDBOX/.claude/hooks/post-tool-use.sh" </dev/null >/dev/null 2>&1); then
  echo "  ✓ 빈 stdin graceful exit 0"
else
  echo "  ✗ 빈 stdin 비정상 종료" >&2
  fail=$((fail + 1))
fi

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
