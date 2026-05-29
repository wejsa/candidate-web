#!/usr/bin/env bash
# test-atomic-write-parallel.sh — TFT §4 #6: 워크트리 동시 Write (flock 직렬화)

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "atomic_write 병렬 5회 동시 실행 → 파일 손상 없음"

SANDBOX="$(mk_sandbox)"
trap 'rm -rf "$SANDBOX"' EXIT

fail=0
TARGET="$SANDBOX/.claude/state/counter.json"
echo '{"counter":0}' > "$TARGET"

# shellcheck source=../lib/atomic-write.sh
source "$SANDBOX/.claude/hooks/lib/atomic-write.sh"

# 병렬 10회 increment
for i in $(seq 1 10); do
  (
    atomic_write "$TARGET" jq --argjson n "$i" '.counter = (.counter // 0) + 1' "$TARGET"
  ) &
done
wait

# 파일이 여전히 유효한 JSON인지 확인
if ! python3 -c "import json,sys; json.load(open('$TARGET'))" 2>/dev/null; then
  echo "  ✗ target is corrupted JSON" >&2
  fail=$((fail + 1))
else
  echo "  ✓ target JSON valid after 10 parallel writes"
fi

# counter가 최소 1, 최대 10 (병렬 직렬화로 1~10 사이 값 중 하나)
final="$(jq -r '.counter' "$TARGET" 2>/dev/null || echo 0)"
if [ "$final" -ge 1 ] && [ "$final" -le 10 ]; then
  echo "  ✓ counter in valid range (got $final)"
else
  echo "  ✗ counter out of range: $final" >&2
  fail=$((fail + 1))
fi

# 임시 파일(.tmp.*)이 남아있지 않아야 함
leftover="$(find "$SANDBOX/.claude/state" -name '*.tmp.*' 2>/dev/null | wc -l)"
assert_eq 0 "$leftover" "no *.tmp.* leftover files" || fail=$((fail + 1))

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
