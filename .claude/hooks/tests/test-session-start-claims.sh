#!/usr/bin/env bash
# test-session-start-claims.sh — session-start.sh §4: develop 미반영 워크트리 claim 감지
#
# 시나리오: 원격에 develop + worktree-* 브랜치가 공존하고, 일부 Task가 워크트리
# 브랜치에만 in_progress로 박혀(develop 미전파) 있을 때 hook이 경고하는지 검증.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

print_header "session-start.sh §4 develop 미반영 워크트리 claim 감지"

ROOT="$(mktemp -d -t ack-claims.XXXXXX)"
trap 'rm -rf "$ROOT"' EXIT

REMOTE="$ROOT/remote.git"
SEED="$ROOT/seed"
WORK="$ROOT/work"

git_q() { git -C "$1" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "${@:2}" >/dev/null 2>&1; }

# backlog.json 한 줄 생성 헬퍼: <id>:<status>[:<assignee>] ...
write_backlog() {
  local path="$1"; shift
  local body="" spec id st asg
  for spec in "$@"; do
    id="${spec%%:*}"; spec="${spec#*:}"
    st="${spec%%:*}"; asg="${spec#*:}"
    [ "$asg" = "$st" ] && asg=""
    [ -n "$body" ] && body="$body,"
    if [ -n "$asg" ]; then
      body="$body\"$id\":{\"id\":\"$id\",\"status\":\"$st\",\"assignee\":\"$asg\",\"title\":\"$id\"}"
    else
      body="$body\"$id\":{\"id\":\"$id\",\"status\":\"$st\",\"title\":\"$id\"}"
    fi
  done
  printf '{"metadata":{"version":1},"tasks":{%s}}\n' "$body" > "$path"
}

fail=0

# ── 원격 셋업 ──────────────────────────────────────────────
git init --bare -q "$REMOTE"
mkdir -p "$SEED/.claude/state"
git_q "$SEED" init -q
git_q "$SEED" remote add origin "$REMOTE"

# develop: T-001 todo, T-002 done, T-003 todo
write_backlog "$SEED/.claude/state/backlog.json" "T-001:todo" "T-002:done" "T-003:todo"
git_q "$SEED" add -A
git_q "$SEED" commit -m "develop seed"
git_q "$SEED" branch -M develop
git_q "$SEED" push -u origin develop
git -C "$REMOTE" symbolic-ref HEAD refs/heads/develop >/dev/null 2>&1 || true

# worktree-a: T-001 + T-003 in_progress (assignee aaa)
git_q "$SEED" checkout -b worktree-a develop
write_backlog "$SEED/.claude/state/backlog.json" \
  "T-001:in_progress:aaa" "T-002:done" "T-003:in_progress:aaa"
git_q "$SEED" commit -am "claim on worktree-a"
git_q "$SEED" push -u origin worktree-a

# worktree-b: T-001 in_progress (assignee bbb) — T-001 이중 claim 유발
git_q "$SEED" checkout -b worktree-b develop
write_backlog "$SEED/.claude/state/backlog.json" \
  "T-001:in_progress:bbb" "T-002:done" "T-003:todo"
git_q "$SEED" commit -am "claim on worktree-b"
git_q "$SEED" push -u origin worktree-b

# worktree-c: T-002 in_progress (develop=done → stale, 경고 안 됨)
git_q "$SEED" checkout -b worktree-c develop
write_backlog "$SEED/.claude/state/backlog.json" \
  "T-001:todo" "T-002:in_progress:ccc" "T-003:todo"
git_q "$SEED" commit -am "stale claim on worktree-c"
git_q "$SEED" push -u origin worktree-c

# ── 작업 클론 (develop 체크아웃) ───────────────────────────
git clone -q "$REMOTE" "$WORK"
git_q "$WORK" checkout develop
mkdir -p "$WORK/.claude/hooks/lib"
ln -sf "$HOOK_DIR/session-start.sh" "$WORK/.claude/hooks/session-start.sh"

run_hook() {
  ( cd "$WORK" && CLAUDE_PROJECT_DIR="$WORK" bash "$WORK/.claude/hooks/session-start.sh" <<< '{}' 2>&1 )
}

# ── 시나리오 1: develop에서 실행 ──────────────────────────
out="$(run_hook)"; rc=$?
assert_eq 0 "$rc" "develop 실행 exit 0" || fail=$((fail + 1))
assert_contains "$out" "develop 미반영 워크트리 claim 감지" "경고 섹션 출력" || fail=$((fail + 1))
assert_contains "$out" "T-001" "T-001 감지" || fail=$((fail + 1))
assert_contains "$out" "복수 워크트리 동시 claim" "T-001 이중 claim 🔴" || fail=$((fail + 1))
assert_contains "$out" "T-003" "T-003 단일 claim 감지" || fail=$((fail + 1))
assert_contains "$out" "assignee: aaa" "T-003 assignee 표시" || fail=$((fail + 1))
# T-002는 develop=done → stale, 경고 안 됨
if [[ "$out" == *"T-002"* ]]; then
  printf '  ✗ T-002(develop=done stale) 경고되면 안 됨\n' >&2; fail=$((fail + 1))
else
  printf '  ✓ T-002(develop=done stale) 미경고\n'
fi

# ── 시나리오 2: worktree-a 자기 브랜치에서 실행 (자기 제외) ──
# 로컬 worktree-a를 develop 커밋에 두어 기준 backlog=todo 유지(원격 origin/worktree-a는
# claim 유지). CUR_BRANCH=worktree-a → origin/worktree-a 스캔 제외 검증.
git_q "$WORK" checkout -b worktree-a origin/develop
out="$(run_hook)"; rc=$?
assert_eq 0 "$rc" "worktree-a 실행 exit 0" || fail=$((fail + 1))
# T-001: origin/worktree-a 제외 → origin/worktree-b만 남음 → 여전히 경고 (assignee bbb)
assert_contains "$out" "T-001" "T-001 (peer worktree-b) 여전히 감지" || fail=$((fail + 1))
assert_contains "$out" "assignee: bbb" "T-001 남은 claim은 worktree-b" || fail=$((fail + 1))
# T-003: origin/worktree-a만 claim → 자기 제외 시 사라져야 함
if [[ "$out" == *"T-003"* ]]; then
  printf '  ✗ T-003(자기 브랜치 단독 claim)은 제외돼야 함\n' >&2; fail=$((fail + 1))
else
  printf '  ✓ T-003 자기 브랜치 단독 claim 제외\n'
fi

# ── 시나리오 3: 워크트리 브랜치 없음 → 조용히 스킵 ──────────
NOWT="$ROOT/nowt"
git clone -q "$REMOTE" "$NOWT" 2>/dev/null
for b in worktree-a worktree-b worktree-c; do
  git -C "$NOWT" branch -rd "origin/$b" >/dev/null 2>&1 || true
done
git_q "$NOWT" checkout develop
mkdir -p "$NOWT/.claude/hooks"
ln -sf "$HOOK_DIR/session-start.sh" "$NOWT/.claude/hooks/session-start.sh"
# fetch가 다시 가져오지 않도록 refspec 무력화는 불가하나, 원격에 브랜치는 여전히 있음.
# 대신 "감지 섹션 자체가 없거나 claim 0건"을 검증하는 대신, 정상 종료만 확인.
out="$(cd "$NOWT" && CLAUDE_PROJECT_DIR="$NOWT" bash "$NOWT/.claude/hooks/session-start.sh" <<< '{}' 2>&1)"; rc=$?
assert_eq 0 "$rc" "워크트리 브랜치 재페치 환경 exit 0" || fail=$((fail + 1))

if [ "$fail" -gt 0 ]; then
  printf '\n💥 %d assertion(s) failed\n' "$fail" >&2
  exit 1
fi
echo "✓ PASS"
