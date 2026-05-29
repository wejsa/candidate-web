#!/usr/bin/env bash
# test-lock-expiry.sh — stop.sh 만료 잠금 해제 (TFT §2 R3 관련)

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "stop.sh 만료 잠금 해제 시나리오"

SANDBOX="$(mk_sandbox)"
trap 'rm -rf "$SANDBOX"' EXIT
BACKLOG="$SANDBOX/.claude/state/backlog.json"

fail=0

# 시간 픽스처: 현재 시각 기준 20분 전 ISO8601 (만료), 1분 전 (미만료), 비-ISO8601
now_epoch="$(date -u +%s)"
expired_iso="$(date -u -d "@$((now_epoch - 1200))" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$((now_epoch - 1200))" '+%Y-%m-%dT%H:%M:%SZ')"
fresh_iso="$(date -u -d "@$((now_epoch - 60))" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$((now_epoch - 60))" '+%Y-%m-%dT%H:%M:%SZ')"

# 3 Task: 만료 / 미만료 / 비-ISO8601 (schema 정합 dict 형식 — key=Task ID)
cat > "$BACKLOG" <<EOF
{
  "workflowState": "active",
  "tasks": {
    "T1": {"id": "T1", "status": "in_progress", "lockedAt": "$expired_iso", "lockedBy": "session-a"},
    "T2": {"id": "T2", "status": "in_progress", "lockedAt": "$fresh_iso", "lockedBy": "session-b"},
    "T3": {"id": "T3", "status": "in_progress", "lockedAt": "garbage-not-iso", "lockedBy": "session-c"}
  }
}
EOF

# stop.sh 실행 (stop_hook_active=false → 정상 진행)
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/stop.sh" <<< '{"stop_hook_active":false}' >/dev/null 2>&1)

# 검증: T1 해제됨, T2 유지, T3은 (현재 구현은 0으로 fallback → 해제됨; M002 이슈로 기록)
t1_locked="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
t2_locked="$(jq -r '.tasks["T2"].lockedAt' "$BACKLOG")"
t3_locked="$(jq -r '.tasks["T3"].lockedAt' "$BACKLOG")"

assert_eq "null" "$t1_locked" "T1 (expired ISO8601) 잠금 해제됨" || fail=$((fail + 1))
assert_eq "$fresh_iso" "$t2_locked" "T2 (fresh ISO8601) 잠금 유지됨" || fail=$((fail + 1))
# T3 (비-ISO8601): 현재 구현은 즉시 만료 처리 — M002 트래킹. 기대: null (현 동작 문서화)
# TODO M002 수정 후 이 assertion을 "garbage-not-iso"로 변경
assert_eq "null" "$t3_locked" "T3 (invalid ISO8601) — 현재 동작: 해제됨 (M002 개선 대상)" || fail=$((fail + 1))

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
