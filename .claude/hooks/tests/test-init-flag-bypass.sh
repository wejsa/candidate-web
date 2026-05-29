#!/usr/bin/env bash
# test-init-flag-bypass.sh — 0-A단계 init/onboard 트리거 보호 마커 (v2.2.0)
#
# skill-init/onboard 트랜잭션 동안은 초기 셋업 다수 Write가 정상이므로
# init-in-progress.flag 존재 시 카운터 진입 자체를 차단해야 한다.
#
# 시나리오:
#   1. 마커 존재 + 5회 연속 호출 → flag/counter 모두 미생성 (카운터 진입 자체 차단)
#   2. 마커 부재 (기본 동작) + 5회 연속 호출 → hook-disabled.flag 생성 (회귀 보호)
#   3. stale 마커 (1시간 + 1초 경과 mtime) + 4회 호출 → 자동 회수 + 정상 비활성화

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "post-tool-use.sh 0-A단계 init-in-progress.flag 우회"

SANDBOX="$(mk_sandbox)"
ln -s "$HOOK_DIR/post-tool-use.sh" "$SANDBOX/.claude/hooks/post-tool-use.sh"
TMP_ISO="$(mktemp -d -t ack-init-flag.XXXXXX)"
trap 'rm -rf "$SANDBOX" "$TMP_ISO"' EXIT

BACKLOG="$SANDBOX/.claude/state/backlog.json"
INIT_FLAG="$SANDBOX/.claude/state/init-in-progress.flag"
DISABLE_FLAG="$SANDBOX/.claude/state/hook-disabled.flag"
COUNTER="$SANDBOX/.claude/state/hook-trigger-count"
SID="init-protected-session"

cat > "$BACKLOG" <<EOF
{
  "metadata": {"lastTaskNumber": 1, "version": 1, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"},
  "workflowState": "active",
  "tasks": {
    "T1": {"id": "T1", "title": "t1", "status": "in_progress", "priority": "high", "createdAt": "2026-01-01T00:00:00Z", "lockedAt": null, "lockedBy": "$SID"}
  }
}
EOF

fail=0

run_hook() {
  local i="$1"
  (cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
    bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
    <<<"{\"session_id\":\"${SID}-$i\",\"tool_input\":{\"file_path\":\"src/foo.kt\"}}" \
    >/dev/null 2>&1)
}

# ── 시나리오 1: 마커 존재 → 5회 호출 후에도 disable/counter 미생성 ──
touch "$INIT_FLAG"
for i in 1 2 3 4 5; do
  run_hook "$i"
done
assert_file_not_exists "$DISABLE_FLAG" "마커 존재 시 5회 호출에도 hook-disabled.flag 미생성" || fail=$((fail + 1))
assert_file_not_exists "$COUNTER" "마커 존재 시 hook-trigger-count 미생성 (카운터 진입 자체 차단)" || fail=$((fail + 1))

# ── 시나리오 2: 마커 부재 → 회귀 보호 (4회째 정상 비활성화) ──
rm -f "$INIT_FLAG" "$DISABLE_FLAG" "$COUNTER"
rm -f "$TMP_ISO"/*.lock 2>/dev/null
for i in a b c d; do
  run_hook "$i"
done
assert_file_exists "$DISABLE_FLAG" "마커 부재 시 4회째 정상 자동 비활성화 (회귀 보호)" || fail=$((fail + 1))

# ── 시나리오 3: stale 마커 (1시간 + 1초 초과) → 자동 회수 + 정상 비활성화 ──
rm -f "$INIT_FLAG" "$DISABLE_FLAG" "$COUNTER"
rm -f "$TMP_ISO"/*.lock 2>/dev/null
touch "$INIT_FLAG"
# mtime을 3601초 전(1시간 + 1초)으로 후퇴 — touch -d 사용
past_iso="$(date -u -d "@$(( $(date -u +%s) - 3601 ))" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$(( $(date -u +%s) - 3601 ))" '+%Y-%m-%dT%H:%M:%SZ')"
touch -d "$past_iso" "$INIT_FLAG" 2>/dev/null || touch -t "$(date -u -d "$past_iso" '+%Y%m%d%H%M' 2>/dev/null)" "$INIT_FLAG" 2>/dev/null || true
for i in s1 s2 s3 s4; do
  run_hook "$i"
done
assert_file_not_exists "$INIT_FLAG" "stale 마커 (TTL 초과) 자동 회수됨" || fail=$((fail + 1))
assert_file_exists "$DISABLE_FLAG" "stale 마커 회수 후 정상 카운터 동작 → 4회째 비활성화" || fail=$((fail + 1))

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
