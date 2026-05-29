#!/usr/bin/env bash
# test-hi04-checker.sh — scripts/check-hook-blocking.sh 자체 검증

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CHECKER="$REPO_ROOT/scripts/check-hook-blocking.sh"

print_header "HI-04 자가 검사 스크립트 검증"

fail=0

# 1. 현재 훅 스크립트 → 통과
if bash "$CHECKER" "$REPO_ROOT/.claude/hooks" >/dev/null 2>&1; then
  echo "  ✓ 현재 훅 스크립트 통과"
else
  echo "  ✗ 현재 훅 스크립트가 HI-04 위반으로 판정됨" >&2
  fail=$((fail + 1))
fi

# 2. 위반 fixture → FAIL 감지
VIOLATE_DIR="$(mktemp -d -t ack-hi04-violate.XXXXXX)"
trap 'rm -rf "$VIOLATE_DIR"' EXIT
cat > "$VIOLATE_DIR/bad-exit.sh" <<'EOF'
#!/usr/bin/env bash
if true; then
  exit 2
fi
EOF
cat > "$VIOLATE_DIR/bad-set.sh" <<'EOF'
#!/usr/bin/env bash
set -e
echo "hi"
EOF

if ! bash "$CHECKER" "$VIOLATE_DIR" >/dev/null 2>&1; then
  echo "  ✓ 위반 fixture 감지됨 (exit 2, set -e)"
else
  echo "  ✗ 위반 fixture를 놓침" >&2
  fail=$((fail + 1))
fi

# 3. 주석 안의 exit 2는 무시해야 함
SAFE_DIR="$(mktemp -d -t ack-hi04-safe.XXXXXX)"
trap 'rm -rf "$VIOLATE_DIR" "$SAFE_DIR"' EXIT
cat > "$SAFE_DIR/comment-only.sh" <<'EOF'
#!/usr/bin/env bash
# R4 규칙: exit 2 금지, set -e 금지
echo "safe"
EOF

if bash "$CHECKER" "$SAFE_DIR" >/dev/null 2>&1; then
  echo "  ✓ 주석 내 exit 2 / set -e 무시"
else
  echo "  ✗ 주석을 위반으로 오판정" >&2
  fail=$((fail + 1))
fi

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
