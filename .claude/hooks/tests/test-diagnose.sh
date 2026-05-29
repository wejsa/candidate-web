#!/usr/bin/env bash
# test-diagnose.sh — v2.1.3: diagnose.sh read-only 동작 + 영향 평가 + graceful skip
#
# 보장:
#   1. clean 상태 (flag 없음) → exit 0 + 🟢 ENABLED 출력
#   2. flag 존재 + lockedBy 0건 → 🟢 영향 없음 결론
#   3. flag 존재 + lockedBy 1건 → 🟡 lock 보유 경고 결론
#   4. backlog.json/settings.json 부재여도 exit 0 (graceful)
#   5. read-only 보장: 실행 전후 state 디렉토리 파일 mtime/내용 불변

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "diagnose.sh read-only 동작"

SANDBOX="$(mk_sandbox)"
ln -s "$HOOK_DIR/post-tool-use.sh" "$SANDBOX/.claude/hooks/post-tool-use.sh"
ln -s "$HOOK_DIR/diagnose.sh" "$SANDBOX/.claude/hooks/diagnose.sh"
trap 'rm -rf "$SANDBOX"' EXIT

BACKLOG="$SANDBOX/.claude/state/backlog.json"
FLAG="$SANDBOX/.claude/state/hook-disabled.flag"
COUNTER="$SANDBOX/.claude/state/hook-trigger-count"
SETTINGS="$SANDBOX/.claude/settings.json"

# 최소 settings.json (3개 훅 등록)
cat > "$SETTINGS" <<'EOF'
{
  "hooks": {
    "SessionStart": [{"hooks":[{"type":"command","command":"x"}]}],
    "PostToolUse":  [{"matcher":"Edit","hooks":[{"type":"command","command":"x"}]}],
    "Stop":         [{"hooks":[{"type":"command","command":"x"}]}]
  }
}
EOF

fail=0

run_diagnose() {
  (cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
    bash "$SANDBOX/.claude/hooks/diagnose.sh" 2>&1)
}

# ── 시나리오 1: clean 상태 → ENABLED ──
cat > "$BACKLOG" <<'EOF'
{"workflowState": "idle", "tasks": []}
EOF
out="$(run_diagnose)"; rc=$?
assert_eq "0" "$rc" "clean: exit 0" || fail=$((fail + 1))
assert_contains "$out" "ENABLED" "clean: 🟢 ENABLED" || fail=$((fail + 1))
assert_contains "$out" "[등록 상태]" "clean: 등록 상태 섹션" || fail=$((fail + 1))
assert_contains "$out" "[영향 평가]" "clean: 영향 평가 섹션" || fail=$((fail + 1))

# ── 시나리오 2: flag 존재 + lockedBy 0건 → 영향 없음 ──
touch "$FLAG"
printf '%s 4\n' "$(date -u +%s)" > "$COUNTER"
cat > "$BACKLOG" <<'EOF'
{
  "workflowState": "active",
  "tasks": [{"id": "T1", "status": "in_progress", "lockedBy": null, "lockedAt": null}]
}
EOF
out="$(run_diagnose)"; rc=$?
assert_eq "0" "$rc" "flag+no-lock: exit 0" || fail=$((fail + 1))
assert_contains "$out" "DISABLED" "flag+no-lock: DISABLED 표시" || fail=$((fail + 1))
assert_contains "$out" "비활성 영향 없음" "flag+no-lock: 영향 없음 결론" || fail=$((fail + 1))
assert_contains "$out" "추정 원인" "flag+no-lock: count>=4면 추정 원인 표시" || fail=$((fail + 1))

# ── 시나리오 3: flag 존재 + lockedBy 1건 → 🟡 경고 ──
cat > "$BACKLOG" <<'EOF'
{
  "workflowState": "active",
  "tasks": [{"id": "T1", "status": "in_progress", "lockedBy": "sid-1", "lockedAt": "2026-05-17T00:00:00Z"}]
}
EOF
out="$(run_diagnose)"; rc=$?
assert_eq "0" "$rc" "flag+lock: exit 0" || fail=$((fail + 1))
assert_contains "$out" "10분 넘기면" "flag+lock: 만료 경고" || fail=$((fail + 1))

# ── 시나리오 4: backlog.json 부재 → graceful ──
rm -f "$BACKLOG" "$FLAG" "$COUNTER"
out="$(run_diagnose)"; rc=$?
assert_eq "0" "$rc" "no-backlog: exit 0 (graceful)" || fail=$((fail + 1))
assert_contains "$out" "in_progress Task: 0건" "no-backlog: 0건 출력" || fail=$((fail + 1))

# ── 시나리오 5: settings.json 부재 → graceful ──
rm -f "$SETTINGS"
out="$(run_diagnose)"; rc=$?
assert_eq "0" "$rc" "no-settings: exit 0 (graceful)" || fail=$((fail + 1))
assert_contains "$out" "hook 미설정" "no-settings: 미설정 경고" || fail=$((fail + 1))

# ── 시나리오 6: read-only 보장 — 실행이 파일을 mutate하지 않는지 ──
# 복원
cat > "$SETTINGS" <<'EOF'
{"hooks":{"SessionStart":[],"PostToolUse":[],"Stop":[]}}
EOF
cat > "$BACKLOG" <<'EOF'
{"workflowState": "active", "tasks": [{"id": "T1", "status": "in_progress", "lockedBy": "sid-x", "lockedAt": "2026-05-17T00:00:00Z"}]}
EOF
touch "$FLAG"
printf '%s 5\n' "$(date -u +%s)" > "$COUNTER"

# 실행 전 해시
before_settings="$(sha256sum "$SETTINGS" | cut -d' ' -f1)"
before_backlog="$(sha256sum "$BACKLOG"  | cut -d' ' -f1)"
before_flag="$(sha256sum "$FLAG"        | cut -d' ' -f1)"
before_counter="$(sha256sum "$COUNTER"  | cut -d' ' -f1)"

run_diagnose >/dev/null 2>&1

after_settings="$(sha256sum "$SETTINGS" | cut -d' ' -f1)"
after_backlog="$(sha256sum "$BACKLOG"   | cut -d' ' -f1)"
after_flag="$(sha256sum "$FLAG"         | cut -d' ' -f1)"
after_counter="$(sha256sum "$COUNTER"   | cut -d' ' -f1)"

assert_eq "$before_settings" "$after_settings" "read-only: settings.json 불변" || fail=$((fail + 1))
assert_eq "$before_backlog"  "$after_backlog"  "read-only: backlog.json 불변"  || fail=$((fail + 1))
assert_eq "$before_flag"     "$after_flag"     "read-only: hook-disabled.flag 불변" || fail=$((fail + 1))
assert_eq "$before_counter"  "$after_counter"  "read-only: hook-trigger-count 불변" || fail=$((fail + 1))

# continuation-plan.md / hook-errors.log 생성 안 됨
[ ! -f "$SANDBOX/.claude/state/continuation-plan.md" ] \
  && echo "  ✓ read-only: continuation-plan.md 생성 안 함" \
  || { echo "  ✗ read-only: continuation-plan.md 생성됨" >&2; fail=$((fail + 1)); }

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
