#!/usr/bin/env bash
# test-session-start-git.sh — TFT §4 #1,2,7: jq/git/비-git 환경 graceful skip

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "session-start.sh graceful skip 시나리오"

SANDBOX="$(mk_sandbox)"
trap 'rm -rf "$SANDBOX"' EXIT

fail=0

# 1. 비-git 디렉토리 (H002 수정 검증 — git 설치 + .git 부재 + rev-parse 실패)
output="$(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/session-start.sh" <<< '{}' 2>&1)"
rc=$?
assert_eq 0 "$rc" "exit 0 on non-git directory" || fail=$((fail + 1))
assert_contains "$output" "비-git" "non-git warning logged" || fail=$((fail + 1))

# 2. jq 미설치 환경 시뮬레이션 — 격리된 bin 디렉토리에 jq 제외한 필수 도구만 심볼릭 링크
printf '{"tasks":[]}' > "$SANDBOX/.claude/state/backlog.json"
FAKE_BIN="$SANDBOX/nojq-bin"
mkdir -p "$FAKE_BIN"
for tool in bash sh git date mkdir printf cat stat rm mv head cut tr wc dirname basename realpath stty; do
  real="$(command -v "$tool" 2>/dev/null || true)"
  [ -n "$real" ] && ln -sf "$real" "$FAKE_BIN/$tool"
done
output="$(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" PATH="$FAKE_BIN" \
  "$FAKE_BIN/bash" "$SANDBOX/.claude/hooks/session-start.sh" <<< '{}' 2>&1)"
rc=$?
assert_eq 0 "$rc" "exit 0 when jq missing" || fail=$((fail + 1))
assert_contains "$output" "jq 미설치" "jq missing warning logged" || fail=$((fail + 1))

# 3. continuation-plan 존재 → stdout 출력 확인
printf '# 이어서 작업\n\n- T1: 테스트\n' > "$SANDBOX/.claude/state/continuation-plan.md"
output="$(cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" \
  bash "$SANDBOX/.claude/hooks/session-start.sh" <<< '{}' 2>&1)"
rc=$?
assert_eq 0 "$rc" "exit 0 with continuation-plan" || fail=$((fail + 1))
assert_contains "$output" "이어서 작업" "continuation-plan content on stdout" || fail=$((fail + 1))

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
