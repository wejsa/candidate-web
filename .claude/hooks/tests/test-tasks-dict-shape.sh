#!/usr/bin/env bash
# test-tasks-dict-shape.sh — schema 정합 dict fixture 회귀 보호
#
# 배경: backlog.schema.json은 `tasks: type=object` (key=Task ID, value=task 객체)로 정의.
# 과거 hook은 `.tasks |= map(...)`을 사용했는데 jq `map(f)`는 array 변환 연산자이므로
# dict에 적용 시 `[{...},{...}]`로 평탄화되어 key가 영구 손실됨 (corruption).
# 본 테스트는 dict 형식 backlog.json이 hook을 통과한 뒤에도:
#   1. .tasks 타입이 "object" 유지
#   2. 원래 키(TASK-001 등)가 보존
#   3. 의도된 갱신(heartbeat / 만료 해제)이 정상 수행
# 됨을 검증한다. v1 array fixture 회귀는 기존 heartbeat/lock-expiry 테스트가 보장.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "schema-정합 dict tasks: hook 통과 후 type/key/값 보존"

SANDBOX="$(mk_sandbox)"
ln -s "$HOOK_DIR/post-tool-use.sh" "$SANDBOX/.claude/hooks/post-tool-use.sh"
TMP_ISO="$(mktemp -d -t ack-dict-shape.XXXXXX)"
trap 'rm -rf "$SANDBOX" "$TMP_ISO"' EXIT

BACKLOG="$SANDBOX/.claude/state/backlog.json"
OWNER_SID="dict-owner-sid"

now_epoch="$(date -u +%s)"
expired_iso="$(date -u -d "@$((now_epoch - 1200))" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$((now_epoch - 1200))" '+%Y-%m-%dT%H:%M:%SZ')"
fresh_iso="$(date -u -d "@$((now_epoch - 60))" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$((now_epoch - 60))" '+%Y-%m-%dT%H:%M:%SZ')"

# schema 정합 dict 형식 — key=Task ID, value=task 객체
cat > "$BACKLOG" <<EOF
{
  "metadata": {"lastTaskNumber": 3, "version": 1, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"},
  "workflowState": "active",
  "tasks": {
    "TASK-001": {"id": "TASK-001", "title": "owned task", "status": "in_progress", "priority": "high", "createdAt": "2026-01-01T00:00:00Z", "lockedAt": "$expired_iso", "lockedBy": "$OWNER_SID"},
    "TASK-002": {"id": "TASK-002", "title": "other task", "status": "in_progress", "priority": "medium", "createdAt": "2026-01-01T00:00:00Z", "lockedAt": "$fresh_iso", "lockedBy": "someone-else"},
    "TASK-003": {"id": "TASK-003", "title": "done task", "status": "done", "priority": "low", "createdAt": "2026-01-01T00:00:00Z"}
  }
}
EOF

fail=0

# ── 시나리오 1: post-tool-use.sh heartbeat (dict 유지 + 소유 Task만 lockedAt 갱신) ──
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
  bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
  <<<"{\"session_id\":\"$OWNER_SID\",\"tool_input\":{\"file_path\":\"src/Main.kt\"}}" \
  >/dev/null 2>&1)

tasks_type="$(jq -r '.tasks | type' "$BACKLOG" 2>/dev/null)"
assert_eq "object" "$tasks_type" "PostToolUse: .tasks 타입 object 유지 (corruption 차단)" || fail=$((fail + 1))

keys_csv="$(jq -r '.tasks | keys_unsorted | join(",")' "$BACKLOG" 2>/dev/null)"
assert_eq "TASK-001,TASK-002,TASK-003" "$keys_csv" "PostToolUse: 원래 키 3개 보존" || fail=$((fail + 1))

t1_locked="$(jq -r '.tasks["TASK-001"].lockedAt' "$BACKLOG" 2>/dev/null)"
if [ "$t1_locked" = "$expired_iso" ] || [ "$t1_locked" = "null" ]; then
  printf '  ✗ TASK-001 heartbeat 갱신 실패 (lockedAt=%s)\n' "$t1_locked" >&2
  fail=$((fail + 1))
else
  printf '  ✓ TASK-001 (owner+in_progress) lockedAt 갱신됨 → %s\n' "$t1_locked"
fi

t2_locked="$(jq -r '.tasks["TASK-002"].lockedAt' "$BACKLOG" 2>/dev/null)"
assert_eq "$fresh_iso" "$t2_locked" "PostToolUse: TASK-002 (다른 세션 소유) 미갱신" || fail=$((fail + 1))

t3_locked="$(jq -r '.tasks["TASK-003"].lockedAt // "null"' "$BACKLOG" 2>/dev/null)"
assert_eq "null" "$t3_locked" "PostToolUse: TASK-003 (done) lockedAt 부재 유지" || fail=$((fail + 1))

# ── 시나리오 2: stop.sh 만료 lock 해제 (dict 유지 + TASK-001만 해제) ──
ln -s "$HOOK_DIR/stop.sh" "$SANDBOX/.claude/hooks/stop.sh" 2>/dev/null || true

# TASK-001을 명시적으로 만료 시각으로 되돌림 (위에서 heartbeat 갱신했을 수 있으므로)
jq --arg expired "$expired_iso" '.tasks["TASK-001"].lockedAt = $expired' "$BACKLOG" > "$BACKLOG.tmp" && mv "$BACKLOG.tmp" "$BACKLOG"

(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/stop.sh" <<< '{"stop_hook_active":false}' >/dev/null 2>&1)

tasks_type2="$(jq -r '.tasks | type' "$BACKLOG" 2>/dev/null)"
assert_eq "object" "$tasks_type2" "Stop: .tasks 타입 object 유지" || fail=$((fail + 1))

keys_csv2="$(jq -r '.tasks | keys_unsorted | join(",")' "$BACKLOG" 2>/dev/null)"
assert_eq "TASK-001,TASK-002,TASK-003" "$keys_csv2" "Stop: 원래 키 3개 보존" || fail=$((fail + 1))

t1_after="$(jq -r '.tasks["TASK-001"].lockedAt' "$BACKLOG" 2>/dev/null)"
assert_eq "null" "$t1_after" "Stop: TASK-001 (만료) lockedAt 해제됨" || fail=$((fail + 1))

t1_by_after="$(jq -r '.tasks["TASK-001"].lockedBy' "$BACKLOG" 2>/dev/null)"
assert_eq "null" "$t1_by_after" "Stop: TASK-001 (만료) lockedBy 해제됨" || fail=$((fail + 1))

t2_after="$(jq -r '.tasks["TASK-002"].lockedAt' "$BACKLOG" 2>/dev/null)"
assert_eq "$fresh_iso" "$t2_after" "Stop: TASK-002 (fresh) lockedAt 유지" || fail=$((fail + 1))

# ── 시나리오 3: 빈 dict tasks도 corruption 없이 통과 ──
cat > "$BACKLOG" <<EOF
{
  "metadata": {"lastTaskNumber": 0, "version": 1, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"},
  "workflowState": "idle",
  "tasks": {}
}
EOF
# 락 정리 후 빈 dict로 실행
rm -f "$TMP_ISO"/*.lock 2>/dev/null
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
  bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
  <<<"{\"session_id\":\"$OWNER_SID\",\"tool_input\":{\"file_path\":\"src/Main.kt\"}}" \
  >/dev/null 2>&1)
empty_type="$(jq -r '.tasks | type' "$BACKLOG" 2>/dev/null)"
assert_eq "object" "$empty_type" "PostToolUse: 빈 dict도 type=object 유지" || fail=$((fail + 1))

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
