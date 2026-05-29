#!/usr/bin/env bash
# test-post-tool-use-lock-reentry.sh — 2단계 파일 락 재진입 방어 (R2)
#
# 락 파일 존재 상태에서 훅 재호출 시 즉시 exit 0 — heartbeat 갱신 없이 종료.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "post-tool-use.sh 2단계 락 재진입 방지"

SANDBOX="$(mk_sandbox)"
ln -s "$HOOK_DIR/post-tool-use.sh" "$SANDBOX/.claude/hooks/post-tool-use.sh"
# 격리된 TMPDIR — 호스트 /tmp와 충돌 방지, 테스트 종료 시 락 정리 보장
TMP_ISO="$(mktemp -d -t ack-post-tool-lock.XXXXXX)"
trap 'rm -rf "$SANDBOX" "$TMP_ISO"' EXIT

BACKLOG="$SANDBOX/.claude/state/backlog.json"
SID="reentry-session"
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

# 미리 락을 생성해둠 → 훅은 재진입으로 판단, 즉시 exit 0
LOCK="$TMP_ISO/ack-hook-${SID}.lock"
touch "$LOCK"

(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
  bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
  <<<"{\"session_id\":\"$SID\",\"tool_input\":{\"file_path\":\"src/foo.kt\"}}" \
  >/dev/null 2>&1)

t1_after="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
assert_eq "$OLD_LOCKED_AT" "$t1_after" "락 존재 시 lockedAt 미갱신 (재진입 방지)" || fail=$((fail + 1))
assert_file_exists "$LOCK" "사전 설치된 락은 보존됨 (훅이 제거 안 함)" || fail=$((fail + 1))

# 락 제거 후 재실행 → 정상 갱신
rm -f "$LOCK"
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
  bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
  <<<"{\"session_id\":\"$SID\",\"tool_input\":{\"file_path\":\"src/foo.kt\"}}" \
  >/dev/null 2>&1)
t1_after="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
if [ "$t1_after" != "$OLD_LOCKED_AT" ] && [ "$t1_after" != "null" ]; then
  echo "  ✓ 락 해제 후 재호출 → lockedAt 갱신됨 (now=$t1_after)"
else
  echo "  ✗ 락 해제 후 갱신 실패: $t1_after" >&2
  fail=$((fail + 1))
fi

# 훅 종료 후 trap으로 락이 정리됐는지 확인
if [ ! -e "$LOCK" ]; then
  echo "  ✓ 훅 정상 종료 후 락 trap 정리됨"
else
  echo "  ✗ 훅 종료 후 락이 남아있음" >&2
  fail=$((fail + 1))
fi

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
