#!/usr/bin/env bash
# test-pre-tool-use-merge-gate.sh — PreToolUse 머지 게이트 (v2.4.0)
#
# 검증: `gh pr merge`만 게이트, 신호 A(backlog 기반) 차단/통과, 우회/비활성/fail-open,
#       PR-번호 추출 견고성(URL·플래그·선행0·정규화), step.prNumber/workflowState.prNumber 양 join.
# 신호 A 테스트는 CCK_GATE_NO_GH=1로 신호 B를 스킵 → 네트워크 비의존 결정적.
# 신호 B(GitHub reviewDecision)는 §10에서 stub `gh`를 PATH에 올려 결정적으로 검증(v2.4.1).
#
# ⚠️ fixture는 **실제 스킬이 쓰는 shape**를 모사한다(자체 리뷰 finding #1):
#    PR 번호는 step.prNumber에 기록되고(skill-impl Step 8), workflowState에는
#    lastReviewDecision만 있고 prNumber는 보통 부재. 게이트 join이 step.prNumber를
#    봐야만 프로덕션에서 발동하므로, fixture가 가짜 필드를 쓰면 안 된다.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
. "$SCRIPT_DIR/_lib.sh"

HOOK="$HOOK_DIR/pre-tool-use.sh"
fails=0

# 모든 sandbox를 누적 추적 → 단일 trap으로 전부 정리 (finding #4: $S만 trap하던 누수)
SANDBOXES=()
cleanup_all() { for d in "${SANDBOXES[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done; }
trap cleanup_all EXIT
new_sandbox() { local d; d="$(mk_sandbox)"; SANDBOXES+=("$d"); printf '%s' "$d"; }

# 실제 shape backlog: step.prNumber에 PR, workflowState엔 lastReviewDecision만.
# 인자: (dir, PR번호, 결정값)
write_backlog() {
  local dir="$1" prn="$2" decision="$3"
  cat > "$dir/.claude/state/backlog.json" <<EOF
{
  "metadata": { "lastTaskNumber": 1, "version": 1, "createdAt": "2026-05-29T00:00:00Z", "updatedAt": "2026-05-29T00:00:00Z" },
  "tasks": {
    "TASK-001": {
      "id": "TASK-001", "title": "샘플", "status": "in_progress", "priority": "high", "createdAt": "2026-05-29T00:00:00Z",
      "currentStep": 1,
      "steps": [ { "number": 1, "title": "Step 1", "status": "pr_created", "prNumber": $prn } ],
      "workflowState": {
        "currentSkill": "skill-review-pr",
        "lastReviewDecision": "$decision",
        "updatedAt": "2026-05-29T00:00:00Z"
      }
    }
  }
}
EOF
}

# workflowState.prNumber 경로만 채운 변형 (CLAUDE.md 템플릿을 LLM이 채운 케이스)
write_backlog_wsonly() {
  local dir="$1" prn="$2" decision="$3"
  cat > "$dir/.claude/state/backlog.json" <<EOF
{
  "metadata": { "lastTaskNumber": 1, "version": 1, "createdAt": "2026-05-29T00:00:00Z", "updatedAt": "2026-05-29T00:00:00Z" },
  "tasks": {
    "TASK-001": {
      "id": "TASK-001", "title": "샘플", "status": "in_progress", "priority": "high", "createdAt": "2026-05-29T00:00:00Z",
      "workflowState": { "currentSkill": "skill-review-pr", "prNumber": $prn, "lastReviewDecision": "$decision", "updatedAt": "2026-05-29T00:00:00Z" }
    }
  }
}
EOF
}

# 훅 실행 → exit code 반환. 사용: run_hook <dir> <command> [env-assignments...]
run_hook() {
  local dir="$1" cmd="$2"; shift 2
  local json
  json="$(jq -nc --arg c "$cmd" '{tool_name:"Bash", tool_input:{command:$c}}')"
  CLAUDE_PROJECT_DIR="$dir" CCK_GATE_NO_GH=1 "$@" bash "$HOOK" <<<"$json" >/dev/null 2>&1
  printf '%s' "$?"
}

# 신호 B 러너: stub `gh`를 PATH 선두에 올리고 CCK_GATE_NO_GH=0으로 실행.
# stub은 `gh pr view N --json reviewDecision -q .reviewDecision` 호출에 <decision>을
# echo한다. <decision>이 "__ERR__"면 exit 1(네트워크/인증 실패 모사 → fail-open 검증).
# 사용: run_hook_gh <dir> <command> <decision>
run_hook_gh() {
  local dir="$1" cmd="$2" decision="$3"
  local bindir="$dir/stubbin"
  mkdir -p "$bindir"
  if [ "$decision" = "__ERR__" ]; then
    printf '#!/usr/bin/env bash\nexit 1\n' > "$bindir/gh"
  else
    printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' "$decision" > "$bindir/gh"
  fi
  chmod +x "$bindir/gh"
  local json
  json="$(jq -nc --arg c "$cmd" '{tool_name:"Bash", tool_input:{command:$c}}')"
  CLAUDE_PROJECT_DIR="$dir" CCK_GATE_NO_GH=0 PATH="$bindir:$PATH" bash "$HOOK" <<<"$json" >/dev/null 2>&1
  printf '%s' "$?"
}

S=$(new_sandbox)

# ── 1. 비대상 명령 → allow ──────────────────────────
print_header "1. 비대상 명령 (git status) → allow(0)"
write_backlog "$S" 42 REQUEST_CHANGES
assert_eq "0" "$(run_hook "$S" "git status")" "비-merge 명령은 통과" || fails=$((fails+1))

# ── 2. step.prNumber join + REQUEST_CHANGES → block ─
print_header "2. gh pr merge 42 (step.prNumber=42, REQUEST_CHANGES) → block(2)"
assert_eq "2" "$(run_hook "$S" "gh pr merge 42 --squash --delete-branch")" "실제 shape(step.prNumber)로 차단" || fails=$((fails+1))
out="$(printf '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 42 --squash"}}' \
  | CLAUDE_PROJECT_DIR="$S" CCK_GATE_NO_GH=1 bash "$HOOK" 2>&1 1>/dev/null)"
assert_contains "$out" "머지 차단" "차단 사유 메시지" || fails=$((fails+1))
assert_contains "$out" "CCK_GATE_BYPASS" "우회 안내 포함" || fails=$((fails+1))

# ── 3. APPROVED / COMMENT → allow ───────────────────
print_header "3. APPROVED·COMMENT 결정 → allow(0)"
write_backlog "$S" 42 APPROVED
assert_eq "0" "$(run_hook "$S" "gh pr merge 42 --squash")" "APPROVED 통과" || fails=$((fails+1))
write_backlog "$S" 42 COMMENT
assert_eq "0" "$(run_hook "$S" "gh pr merge 42 --squash")" "COMMENT 통과 (REQUEST_CHANGES만 차단)" || fails=$((fails+1))

# ── 4. 우회 / 비활성 ────────────────────────────────
print_header "4. 우회(BYPASS)·비활성(GATE=off) → allow(0)"
write_backlog "$S" 42 REQUEST_CHANGES
assert_eq "0" "$(run_hook "$S" "gh pr merge 42 --squash" env CCK_GATE_BYPASS=1)" "CCK_GATE_BYPASS 우회" || fails=$((fails+1))
assert_eq "0" "$(run_hook "$S" "gh pr merge 42 --squash" env CCK_MERGE_GATE=off)" "CCK_MERGE_GATE=off 비활성" || fails=$((fails+1))

# ── 5. fail-open: backlog 부재 / 번호 추출 불가 / 미매칭 ──
print_header "5. fail-open 시나리오 → allow(0)"
S5=$(new_sandbox)
assert_eq "0" "$(run_hook "$S5" "gh pr merge 42 --squash")" "backlog 부재 fail-open" || fails=$((fails+1))
assert_eq "0" "$(run_hook "$S" "gh pr merge --squash")" "PR 번호 없음 fail-open" || fails=$((fails+1))
assert_eq "0" "$(run_hook "$S" "gh pr merge 99 --squash")" "미매칭 PR 통과" || fails=$((fails+1))

# ── 6. PR-번호 추출 견고성 (finding #2) ─────────────
print_header "6. 추출 견고성: URL·플래그·선행0 → 정확히 42로 차단(2)"
write_backlog "$S" 42 REQUEST_CHANGES
assert_eq "2" "$(run_hook "$S" "gh pr merge https://github.com/o/repo123/pull/42 --squash")" "URL repo123의 123 아닌 42 추출" || fails=$((fails+1))
assert_eq "2" "$(run_hook "$S" "gh pr merge -R o/r2 42 --squash")" "플래그 r2의 2 아닌 42 추출" || fails=$((fails+1))
assert_eq "2" "$(run_hook "$S" "gh pr merge 042 --squash")" "선행0 042 → 42 정규화 후 차단" || fails=$((fails+1))
# greedy 우회 방지: 후행에 'gh pr merge' 문구 반복돼도 첫 번호 채택
assert_eq "2" "$(run_hook "$S" "gh pr merge 42 # nb: gh pr merge docs")" "후행 반복 문구 greedy 우회 차단" || fails=$((fails+1))

# ── 7. 임베드 숫자 오추출 안 함 (STRONG: PR=123으로 무장한 대조 검증) ──
# fixture의 PR을 123 + REQUEST_CHANGES로 두고, SHA `abc123def`가 든 명령을 보낸다.
# 만약 추출기가 `abc123def`에서 123을 잘못 뽑으면 차단(2)되어 테스트가 실패한다.
# 올바른 추출기는 순수-숫자 토큰이 없어 empty → fail-open allow(0). (weak 시나리오 강화)
print_header "7. SHA 'abc123def'의 123 오추출 안 함 → allow(0), 진짜 123은 차단(2)"
write_backlog "$S" 123 REQUEST_CHANGES
assert_eq "0" "$(run_hook "$S" "gh pr merge --match-head-commit abc123def --squash")" "SHA 임베드 123 비추출(오추출 시 차단되어 실패할 강한 검증)" || fails=$((fails+1))
assert_eq "2" "$(run_hook "$S" "gh pr merge 123 --squash")" "대조: 무장된 fixture의 진짜 PR 123은 차단" || fails=$((fails+1))

# ── 8. workflowState.prNumber 경로 join ─────────────
print_header "8. workflowState.prNumber=42 + REQUEST_CHANGES → block(2)"
write_backlog_wsonly "$S" 42 REQUEST_CHANGES
assert_eq "2" "$(run_hook "$S" "gh pr merge 42 --squash")" "workflowState.prNumber 경로도 차단" || fails=$((fails+1))

# ── 9. 공백/탭 정규화 ───────────────────────────────
print_header "9. 다중 공백 'gh   pr   merge   42' → block(2)"
write_backlog "$S" 42 REQUEST_CHANGES
assert_eq "2" "$(run_hook "$S" "gh   pr   merge   42   --squash")" "공백 정규화 후 차단" || fails=$((fails+1))

# ── 10. 신호 B (GitHub reviewDecision) — stub gh, backlog 부재(신호 A 미발동) ──
# backlog 없는 sandbox에서 신호 A는 스킵되고, stub gh의 reviewDecision만으로 판정.
print_header "10. 신호 B: stub gh reviewDecision → block/allow/fail-open"
S10=$(new_sandbox)   # backlog 없음 → 신호 A 미발동, 신호 B 단독 검증
assert_eq "2" "$(run_hook_gh "$S10" "gh pr merge 7 --squash" CHANGES_REQUESTED)" "CHANGES_REQUESTED → block(2)" || fails=$((fails+1))
assert_eq "0" "$(run_hook_gh "$S10" "gh pr merge 7 --squash" APPROVED)" "APPROVED → allow(0)" || fails=$((fails+1))
assert_eq "0" "$(run_hook_gh "$S10" "gh pr merge 7 --squash" __ERR__)" "gh 실패(네트워크/인증) → fail-open allow(0)" || fails=$((fails+1))
# 신호 A(backlog REQUEST_CHANGES)가 있으면 신호 B(APPROVED)와 무관하게 차단 — A 우선
assert_eq "2" "$(run_hook_gh "$S" "gh pr merge 42 --squash" APPROVED)" "신호 A(REQUEST_CHANGES) 우선 — gh가 APPROVED여도 차단" || fails=$((fails+1))

printf '\n'
if [ "$fails" -eq 0 ]; then
  printf '✅ test-pre-tool-use-merge-gate: 전체 통과\n'; exit 0
else
  printf '❌ test-pre-tool-use-merge-gate: %d개 실패\n' "$fails"; exit 1
fi
