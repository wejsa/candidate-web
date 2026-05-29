#!/usr/bin/env bash
# test-threshold-env-override.sh — v2.1.3: CCK_HOOK_THRESHOLD / CCK_HOOK_WINDOW_SEC env override
#
# 보장 (시나리오):
#   1. CCK_HOOK_THRESHOLD=5 + WINDOW=3600 → 5회까지 flag 미생성, 6회째 생성
#      (H004: WINDOW=3600으로 시간 의존 제거 — CI 부하 무관)
#   2. 비숫자 env → 기본값 3 fallback (회귀 0)
#   3. 0 값 → 기본값 3 fallback (회귀 0)
#   4. env 미설정 → 기본값 3 유지 (회귀 0)
#   5. CCK_HOOK_WINDOW_SEC=1 → 1초 경과 후 카운터 리셋 (H002 추가)
#
# 가드 규약 (H001/H003):
#   - 모든 검증 분기에서 fail 카운터 연결 (false PASS 차단)
#   - 조기 실패(early_fail) 발생 시 후속 assert 스킵

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "post-tool-use.sh threshold/window env override"

SANDBOX="$(mk_sandbox)"
ln -s "$HOOK_DIR/post-tool-use.sh" "$SANDBOX/.claude/hooks/post-tool-use.sh"
TMP_ISO="$(mktemp -d -t ack-thr-override.XXXXXX)"
trap 'rm -rf "$SANDBOX" "$TMP_ISO"' EXIT

BACKLOG="$SANDBOX/.claude/state/backlog.json"
FLAG="$SANDBOX/.claude/state/hook-disabled.flag"
COUNTER="$SANDBOX/.claude/state/hook-trigger-count"
SID="thr-session"
cat > "$BACKLOG" <<EOF
{
  "workflowState": "active",
  "tasks": [
    {"id": "T1", "status": "in_progress", "lockedAt": null, "lockedBy": "$SID"}
  ]
}
EOF

fail=0

run_hook() {
  local i="$1"
  local threshold="${2:-}"
  local window="${3:-}"
  (cd "$SANDBOX" \
    && CLAUDE_PROJECT_DIR="$SANDBOX" \
       TMPDIR="$TMP_ISO" \
       CCK_HOOK_THRESHOLD="$threshold" \
       CCK_HOOK_WINDOW_SEC="$window" \
       bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
       <<<"{\"session_id\":\"${SID}-$i\",\"tool_input\":{\"file_path\":\"src/foo.kt\"}}" \
       >/dev/null 2>/dev/null)
}

# run_hook with explicit unset (env 미설정 시나리오용)
run_hook_unset() {
  local i="$1"
  (cd "$SANDBOX" && unset CCK_HOOK_THRESHOLD CCK_HOOK_WINDOW_SEC \
    && CLAUDE_PROJECT_DIR="$SANDBOX" TMPDIR="$TMP_ISO" \
       bash "$SANDBOX/.claude/hooks/post-tool-use.sh" \
       <<<"{\"session_id\":\"${SID}-$i\",\"tool_input\":{\"file_path\":\"src/foo.kt\"}}" \
       >/dev/null 2>/dev/null)
}

# ── 시나리오 1: THRESHOLD=5 + WINDOW=3600 → 5회까지 미생성, 6회째 생성 ──
#   (H004: WINDOW=3600으로 시간 의존 제거. CI 부하 높아도 false PASS 차단)
early_fail=0
for i in 1 2 3 4 5; do
  run_hook "$i" "5" "3600"
  if [ -f "$FLAG" ]; then
    echo "  ✗ THRESHOLD=5에서 $i회째 조기 플래그 생성" >&2
    fail=$((fail + 1))
    early_fail=1
    break
  fi
done
if [ "$early_fail" = 0 ]; then
  if [ ! -f "$FLAG" ]; then
    echo "  ✓ THRESHOLD=5: 5회까지 플래그 미생성"
  else
    echo "  ✗ 회귀: 5회 끝났는데 flag 존재" >&2
    fail=$((fail + 1))
    early_fail=1
  fi
fi
if [ "$early_fail" = 0 ]; then
  run_hook "6" "5" "3600"
  assert_file_exists "$FLAG" "THRESHOLD=5: 6회째(>5) 플래그 생성" || fail=$((fail + 1))
fi

# 초기화
rm -f "$FLAG" "$COUNTER"

# ── 시나리오 2: 비숫자 값 → 기본값 3 fallback ──
early_fail=0
for i in 1 2 3; do
  run_hook "n$i" "abc" "xyz"
  if [ -f "$FLAG" ]; then
    echo "  ✗ 비숫자 fallback 실패: $i회째 조기 플래그" >&2
    fail=$((fail + 1))
    early_fail=1
    break
  fi
done
if [ "$early_fail" = 0 ]; then
  if [ ! -f "$FLAG" ]; then
    echo "  ✓ 비숫자 env: 3회까지 기본값 3 동작 (fallback)"
  else
    echo "  ✗ 회귀: 비숫자 env에서 3회 끝났는데 flag 존재" >&2
    fail=$((fail + 1))
    early_fail=1
  fi
fi
if [ "$early_fail" = 0 ]; then
  run_hook "n4" "abc" "xyz"
  assert_file_exists "$FLAG" "비숫자 env → 기본값 3 fallback (4회째 발동)" || fail=$((fail + 1))
fi

# 초기화
rm -f "$FLAG" "$COUNTER"

# ── 시나리오 3: 0 값 → 기본값 3 fallback ──
early_fail=0
for i in 1 2 3; do
  run_hook "z$i" "0" "0"
  if [ -f "$FLAG" ]; then
    echo "  ✗ 0 값 fallback 실패: $i회째 조기 플래그" >&2
    fail=$((fail + 1))
    early_fail=1
    break
  fi
done
if [ "$early_fail" = 0 ]; then
  if [ ! -f "$FLAG" ]; then
    echo "  ✓ 0 값 env: 3회까지 기본값 3 동작 (fallback)"
  else
    echo "  ✗ 회귀: 0 값 env에서 3회 끝났는데 flag 존재" >&2
    fail=$((fail + 1))
    early_fail=1
  fi
fi
if [ "$early_fail" = 0 ]; then
  run_hook "z4" "0" "0"
  assert_file_exists "$FLAG" "0 값 → 기본값 3 fallback (4회째 발동)" || fail=$((fail + 1))
fi

# 초기화
rm -f "$FLAG" "$COUNTER"

# ── 시나리오 4: env 미설정 → 기본값 3 유지 (회귀 0) ──
early_fail=0
for i in 1 2 3; do
  run_hook_unset "d$i"
done
if [ ! -f "$FLAG" ]; then
  echo "  ✓ env 미설정: 3회까지 기본 동작 유지"
else
  echo "  ✗ 회귀: env 미설정에서 3회 안에 flag 생성됨 (회귀 발생)" >&2
  fail=$((fail + 1))
  early_fail=1
fi
if [ "$early_fail" = 0 ]; then
  run_hook_unset "d4"
  assert_file_exists "$FLAG" "env 미설정: 4회째 기본값 3 초과로 발동 (회귀 0)" || fail=$((fail + 1))
fi

# 초기화
rm -f "$FLAG" "$COUNTER"

# ── 시나리오 5 (H002 신규): WINDOW_SEC=1 → 2초 경과 후 카운터 리셋 ──
# THRESHOLD=3 유지하면서 window를 1초로 좁힘. 2초 대기 시 카운터 리셋되어
# 3회째 호출에서도 flag 미생성. WINDOW_SEC override의 실효성 검증.
early_fail=0
run_hook "w1" "3" "1"
run_hook "w2" "3" "1"
if [ -f "$FLAG" ]; then
  echo "  ✗ WINDOW=1: 2회 호출에서 조기 플래그" >&2
  fail=$((fail + 1))
  early_fail=1
fi
# 2초 sleep → 윈도우 경과 → 다음 호출에서 카운터 리셋
sleep 2
if [ "$early_fail" = 0 ]; then
  run_hook "w3" "3" "1"
  if [ ! -f "$FLAG" ]; then
    echo "  ✓ WINDOW=1: 2초 경과 후 카운터 리셋 (3회째 호출도 flag 미생성)"
  else
    echo "  ✗ WINDOW=1 리셋 실패: 카운터 리셋 안 됨" >&2
    fail=$((fail + 1))
    early_fail=1
  fi
fi
if [ "$early_fail" = 0 ] && [ -f "$COUNTER" ]; then
  read -r _ c < "$COUNTER"
  assert_eq "1" "$c" "WINDOW=1: 리셋 후 카운터 COUNT=1" || fail=$((fail + 1))
fi

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
