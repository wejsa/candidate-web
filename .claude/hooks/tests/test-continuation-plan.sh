#!/usr/bin/env bash
# test-continuation-plan.sh — stop.sh 디바운스 + idle 스킵 + 정상 생성

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "stop.sh continuation-plan 조건부 갱신"

SANDBOX="$(mk_sandbox)"
trap 'rm -rf "$SANDBOX"' EXIT
BACKLOG="$SANDBOX/.claude/state/backlog.json"
PLAN="$SANDBOX/.claude/state/continuation-plan.md"

fail=0

# 시나리오 1: workflowState=idle → continuation-plan 생성 스킵
printf '{"workflowState":"idle","tasks":[]}' > "$BACKLOG"
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/stop.sh" <<< '{"stop_hook_active":false}' >/dev/null 2>&1)
if [ ! -f "$PLAN" ]; then
  echo "  ✓ idle 상태에서 continuation-plan 생성 안 함"
else
  echo "  ✗ idle인데 continuation-plan이 생성됨" >&2
  fail=$((fail + 1))
fi

# 시나리오 2: 활성 Task 있음 → continuation-plan 생성
cat > "$BACKLOG" <<'EOF'
{
  "workflowState": "active",
  "tasks": [
    {"id": "TASK-100", "status": "in_progress", "title": "테스트 작업"}
  ]
}
EOF
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/stop.sh" <<< '{"stop_hook_active":false}' >/dev/null 2>&1)
assert_file_exists "$PLAN" "continuation-plan 생성됨 (active workflow)" || fail=$((fail + 1))
if [ -f "$PLAN" ]; then
  content="$(cat "$PLAN")"
  assert_contains "$content" "TASK-100" "plan에 활성 Task 기록됨" || fail=$((fail + 1))
  assert_contains "$content" "테스트 작업" "plan에 Task 제목 기록됨" || fail=$((fail + 1))
fi

# 시나리오 3: 디바운스 — 즉시 재실행 시 mtime 변경 없음
before_mtime="$(stat -c %Y "$PLAN" 2>/dev/null || stat -f %m "$PLAN")"
sleep 1
(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/stop.sh" <<< '{"stop_hook_active":false}' >/dev/null 2>&1)
after_mtime="$(stat -c %Y "$PLAN" 2>/dev/null || stat -f %m "$PLAN")"
assert_eq "$before_mtime" "$after_mtime" "60초 디바운스 (재실행 시 mtime 동일)" || fail=$((fail + 1))

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
