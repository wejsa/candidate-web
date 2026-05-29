#!/usr/bin/env bash
# run-all.sh — 훅 회귀 테스트 전체 실행

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tests=(
  "test-stop-recursion.sh"
  "test-atomic-write-parallel.sh"
  "test-lock-expiry.sh"
  "test-session-start-git.sh"
  "test-session-start-claims.sh"
  "test-continuation-plan.sh"
  "test-hi04-checker.sh"
  "test-post-tool-use-path-exclude.sh"
  "test-post-tool-use-lock-reentry.sh"
  "test-post-tool-use-auto-disable.sh"
  "test-post-tool-use-heartbeat.sh"
  "test-threshold-env-override.sh"
  "test-diagnose.sh"
  "test-tasks-dict-shape.sh"
  "test-init-flag-bypass.sh"
)

passed=0
failed=0
failed_names=()

for t in "${tests[@]}"; do
  printf '\n=== %s ===\n' "$t"
  if bash "$SCRIPT_DIR/$t"; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    failed_names+=("$t")
  fi
done

printf '\n──────────────\n'
printf '✅ PASS: %d\n' "$passed"
printf '❌ FAIL: %d\n' "$failed"
if [ "$failed" -gt 0 ]; then
  printf '\n실패 테스트:\n'
  for n in "${failed_names[@]}"; do
    printf '  - %s\n' "$n"
  done
  exit 1
fi
