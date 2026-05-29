#!/usr/bin/env bash
# test-post-tool-use-auto-disable.sh — 3단계 트리거 카운터 자동 비활성화
#
# 10초 윈도우 내 3회를 초과하면 hook-disabled.flag 생성 + stderr 경고 출력.
# 이후 호출은 0단계에서 즉시 종료.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "post-tool-use.sh 3단계 자동 비활성화"

SANDBOX="$(mk_sandbox)"
ln -s "$HOOK_DIR/post-tool-use.sh" "$SANDBOX/.claude/hooks/post-tool-use.sh"
TMP_ISO="$(mktemp -d -t ack-post-tool-autodis.XXXXXX)"
trap 'rm -rf "$SANDBOX" "$TMP_ISO"' EXIT

BACKLOG="$SANDBOX/.claude/state/backlog.json"
FLAG="$SANDBOX/.claude/state/hook-disabled.flag"
COUNTER="$SANDBOX/.claude/state/hook-trigger-count"
SID="burst-session"
cat > "$BACKLOG" <<EOF
{
  "workflowState": "active",
  "tasks": {
    "T1": {"id": "T1", "status": "in_progress", "lockedAt": null, "lockedBy": "$SID"}
  }
}
EOF

fail=0
STDERR_LOG="$TMP_ISO/stderr.log"

run_hook() {
  # 각 호출마다 락 충돌을 피하기 위해 세션 ID를 유니크하게 (카운터는 공용 파일)
  local i="$1"
  (cd "$SANDBOX" && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
    bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
    <<<"{\"session_id\":\"${SID}-$i\",\"tool_input\":{\"file_path\":\"src/foo.kt\"}}" \
    >/dev/null 2>>"$STDERR_LOG")
}

# 1~3회: 플래그 생성 안 됨, COUNTER 값 경계 명시 (H010)
for i in 1 2 3; do
  run_hook "$i"
  if [ -f "$FLAG" ]; then
    echo "  ✗ $i회 호출에서 플래그 조기 생성" >&2
    fail=$((fail + 1))
    break
  fi
  if [ -f "$COUNTER" ]; then
    read -r _ c < "$COUNTER"
    assert_eq "$i" "$c" "${i}회 호출 후 COUNT=$i, 플래그 미생성" || fail=$((fail + 1))
  fi
done
[ -f "$FLAG" ] || echo "  ✓ 3회까지는 플래그 미생성"

# 4회: 플래그 생성 + stderr 경고 + COUNT=4
run_hook "4"
assert_file_exists "$FLAG" "4회째(>TRIGGER_MAX=3) 시 hook-disabled.flag 생성" || fail=$((fail + 1))
if [ -f "$COUNTER" ]; then
  read -r _ c < "$COUNTER"
  assert_eq "4" "$c" "4회째 호출 후 COUNT=4" || fail=$((fail + 1))
fi

if grep -q "자동 비활성화" "$STDERR_LOG"; then
  echo "  ✓ stderr에 비활성화 경고 출력"
else
  echo "  ✗ stderr 경고 누락" >&2
  fail=$((fail + 1))
fi

# 플래그 존재 상태에서 후속 호출은 즉시 종료 — lockedAt이 갱신되지 않아야 함
# (4회 발동 당시 이미 락 경쟁 가능성 있으므로 flag 남은 상태 확인만 수행)
BEFORE_LOCK="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
run_hook "5"
AFTER_LOCK="$(jq -r '.tasks["T1"].lockedAt' "$BACKLOG")"
assert_eq "$BEFORE_LOCK" "$AFTER_LOCK" "플래그 존재 시 heartbeat 갱신 차단" || fail=$((fail + 1))

# ── 10초 윈도우 롤오버 (H008): 과거 타임스탬프 주입 → 카운터 리셋 검증 ──
# 플래그 제거 + 카운터 파일에 11초 전 타임스탬프/비현실적 카운트 주입
rm -f "$FLAG"
past=$(( $(date -u +%s) - 11 ))
printf '%s 99\n' "$past" > "$COUNTER"
run_hook "rollover"
assert_file_not_exists "$FLAG" "10초 경과 시 플래그 미생성" || fail=$((fail + 1))
if [ -f "$COUNTER" ]; then
  read -r _ c < "$COUNTER"
  assert_eq "1" "$c" "10초 경과 시 카운터 리셋 → COUNT=1" || fail=$((fail + 1))
fi

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
