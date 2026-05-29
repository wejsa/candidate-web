#!/usr/bin/env bash
# diagnose.sh — v2.1.3: read-only hook 진단 도구
#
# 목적:
#   네이티브 훅(SessionStart/PostToolUse/Stop)의 현재 상태와 자동 비활성화 영향을
#   한 번에 점검. 모든 파일은 read-only — backlog.json, flag, counter, plan 어느 것도
#   mutate하지 않는다.
#
# 사용:
#   bash .claude/hooks/diagnose.sh
#
# 출력 구조:
#   [등록 상태]   settings.json hook 등록 + 스크립트 존재 여부
#   [PostToolUse] flag/counter 상태 + 추정 원인
#   [Stop]        continuation-plan + 만료 임박 lock 후보
#   [영향 평가]   PostToolUse 비활성 시 진행 중 작업이 받는 영향
#   [행동 옵션]   복구/임계값 조정/방치 중 선택 가이드
#
# 규약:
#   - 모든 실패 경로 exit 0 (graceful skip). 사용법 오류만 exit 1.
#   - 외부 도구 미설치(jq/git)는 가용 항목만 출력.

set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$PROJECT_DIR" 2>/dev/null || { echo "❌ 디렉토리 진입 실패: $PROJECT_DIR" >&2; exit 1; }

STATE_DIR=".claude/state"
HOOKS_DIR=".claude/hooks"
SETTINGS=".claude/settings.json"
BACKLOG="$STATE_DIR/backlog.json"
FLAG="$STATE_DIR/hook-disabled.flag"
COUNTER="$STATE_DIR/hook-trigger-count"
ERROR_LOG="$STATE_DIR/hook-errors.log"
CONT_PLAN="$STATE_DIR/continuation-plan.md"

have_jq=0; command -v jq >/dev/null 2>&1 && have_jq=1

# Effective threshold/window — post-tool-use.sh와 동일한 fallback 규칙.
# "추정 원인" 메시지에 반영해서 env override 의도와 일관된 출력 보장 (M001).
EFFECTIVE_THRESHOLD="${CCK_HOOK_THRESHOLD:-3}"
EFFECTIVE_WINDOW="${CCK_HOOK_WINDOW_SEC:-10}"
case "$EFFECTIVE_THRESHOLD" in ''|*[!0-9]*) EFFECTIVE_THRESHOLD=3 ;; esac
case "$EFFECTIVE_WINDOW"    in ''|*[!0-9]*) EFFECTIVE_WINDOW=10 ;; esac
[ "$EFFECTIVE_THRESHOLD" -lt 1 ] 2>/dev/null && EFFECTIVE_THRESHOLD=3
[ "$EFFECTIVE_WINDOW"    -lt 1 ] 2>/dev/null && EFFECTIVE_WINDOW=10

# Unix epoch → ISO8601 (UTC). date -u 호환(GNU/BSD).
to_iso() {
  local ep="$1"
  if date -u -d "@$ep" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null; then return; fi
  if date -u -r "$ep" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null; then return; fi
  printf '(epoch=%s)' "$ep"
}

age_human() {
  local then_ep="$1" now_ep
  now_ep="$(date -u +%s)"
  local diff=$((now_ep - then_ep))
  [ "$diff" -lt 0 ] && diff=0
  if [ "$diff" -lt 60 ]; then printf '%ds ago' "$diff"
  elif [ "$diff" -lt 3600 ]; then printf '%dm ago' $((diff / 60))
  elif [ "$diff" -lt 86400 ]; then printf '%dh ago' $((diff / 3600))
  else printf '%dd ago' $((diff / 86400))
  fi
}

stat_mtime() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

printf '== ai-crew-kit hook diagnosis (%s) ==\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf 'project: %s\n\n' "$PROJECT_DIR"

# ── [등록 상태] ───────────────────────────────────────────────
printf '[등록 상태]\n'
if [ -f "$SETTINGS" ]; then
  if [ "$have_jq" -eq 1 ]; then
    for hook in SessionStart PostToolUse Stop; do
      cnt="$(jq -r --arg h "$hook" '.hooks[$h] // [] | length' "$SETTINGS" 2>/dev/null || echo 0)"
      printf '  %-13s registered=%s\n' "$hook" "$cnt"
    done
  else
    printf '  (jq 미설치 — settings.json 파싱 스킵)\n'
  fi
else
  printf '  ⚠️  %s 부재 — hook 미설정\n' "$SETTINGS"
fi
for script in session-start.sh post-tool-use.sh stop.sh; do
  if [ -x "$HOOKS_DIR/$script" ]; then
    printf '  ✓ %s/%s\n' "$HOOKS_DIR" "$script"
  elif [ -f "$HOOKS_DIR/$script" ]; then
    printf '  ⚠️  %s/%s (실행 권한 없음)\n' "$HOOKS_DIR" "$script"
  else
    printf '  ✗ %s/%s 부재\n' "$HOOKS_DIR" "$script"
  fi
done

# ── [PostToolUse] ────────────────────────────────────────────
printf '\n[PostToolUse]\n'
if [ -f "$FLAG" ]; then
  flag_mtime="$(stat_mtime "$FLAG")"
  printf '  status: 🔴 DISABLED since %s (%s)\n' "$(to_iso "$flag_mtime")" "$(age_human "$flag_mtime")"
else
  printf '  status: 🟢 ENABLED\n'
fi
if [ -f "$COUNTER" ]; then
  read -r win_start cnt < "$COUNTER" 2>/dev/null || { win_start=0; cnt=0; }
  # 비숫자/공백 sanitize — counter 파일 오염 방지 (M005 방어적 일관성)
  case "${win_start:-}" in ''|*[!0-9]*) win_start=0 ;; esac
  case "${cnt:-}"       in ''|*[!0-9]*) cnt=0 ;; esac
  printf '  trigger-count: window_start=%s count=%s\n' "$(to_iso "$win_start")" "$cnt"
  if [ "$cnt" -gt "$EFFECTIVE_THRESHOLD" ] 2>/dev/null; then
    printf '  추정 원인: 응답 1회당 Edit/Write %s회 (%s초 윈도우 내 임계값 %s 초과)\n' \
      "$cnt" "$EFFECTIVE_WINDOW" "$EFFECTIVE_THRESHOLD"
  fi
else
  printf '  trigger-count: (파일 없음 — 최근 발동 흔적 없음)\n'
fi
if [ -f "$ERROR_LOG" ]; then
  last_disable="$(grep '자동 비활성화 발동' "$ERROR_LOG" 2>/dev/null | tail -1)"
  [ -n "$last_disable" ] && printf '  last disable log: %s\n' "$last_disable"
fi
# 환경변수 override 가시화
if [ -n "${CCK_HOOK_THRESHOLD:-}" ] || [ -n "${CCK_HOOK_WINDOW_SEC:-}" ]; then
  printf '  env override: CCK_HOOK_THRESHOLD=%s CCK_HOOK_WINDOW_SEC=%s\n' \
    "${CCK_HOOK_THRESHOLD:-(unset)}" "${CCK_HOOK_WINDOW_SEC:-(unset)}"
fi

# ── [Stop] ───────────────────────────────────────────────────
printf '\n[Stop]\n'
if [ -f "$CONT_PLAN" ]; then
  cp_mtime="$(stat_mtime "$CONT_PLAN")"
  printf '  continuation-plan.md: present (updated %s)\n' "$(age_human "$cp_mtime")"
else
  printf '  continuation-plan.md: absent (idle/0건 스킵 정책의 정상 결과일 수 있음)\n'
fi
# 만료 임박/만료된 lock 후보 — stop.sh가 다음 턴에 해제할 대상 (TTL=600s)
expired_count=0; near_count=0
if [ "$have_jq" -eq 1 ] && [ -f "$BACKLOG" ]; then
  now_ep="$(date -u +%s)"
  expired_count="$(jq --argjson now "$now_ep" --argjson ttl 600 '
    [.tasks[]? | select(
      (.lockedAt // "") != "" and
      ((.lockedAt | fromdateiso8601?) // 0) < ($now - $ttl)
    )] | length' "$BACKLOG" 2>/dev/null || echo 0)"
  near_count="$(jq --argjson now "$now_ep" --argjson ttl 600 '
    [.tasks[]? | select(
      (.lockedAt // "") != "" and
      ((.lockedAt | fromdateiso8601?) // 0) >= ($now - $ttl) and
      ((.lockedAt | fromdateiso8601?) // 0) < ($now - $ttl + 120)
    )] | length' "$BACKLOG" 2>/dev/null || echo 0)"
  printf '  만료된 lock (다음 stop 턴에 해제): %s건\n' "$expired_count"
  printf '  만료 임박 lock (2분 이내): %s건\n' "$near_count"
fi

# ── [영향 평가] ──────────────────────────────────────────────
printf '\n[영향 평가]\n'
in_progress_total=0; with_lock=0
if [ "$have_jq" -eq 1 ] && [ -f "$BACKLOG" ]; then
  in_progress_total="$(jq -r '[.tasks[]? | select(.status == "in_progress")] | length' "$BACKLOG" 2>/dev/null || echo 0)"
  with_lock="$(jq -r '[.tasks[]? | select(.status == "in_progress" and (.lockedBy // "") != "")] | length' "$BACKLOG" 2>/dev/null || echo 0)"
fi
printf '  in_progress Task: %s건 (lockedBy 설정됨: %s건)\n' "$in_progress_total" "$with_lock"

if [ -f "$FLAG" ]; then
  if [ "$with_lock" = "0" ]; then
    printf '  🟢 결론: PostToolUse 비활성 영향 없음 (소유된 lock 0건). 복구 선택사항.\n'
  else
    printf '  🟡 결론: lock 보유 작업이 10분 넘기면 stop 만료 정책으로 자동 해제됨.\n'
    printf '         짧은 작업은 안전, 장기 작업이면 복구 권장.\n'
  fi
else
  printf '  🟢 결론: PostToolUse 정상. heartbeat 매 Edit/Write마다 갱신됨.\n'
fi

# ── [행동 옵션] ──────────────────────────────────────────────
printf '\n[행동 옵션]\n'
if [ -f "$FLAG" ]; then
  printf '  [A] 그대로 진행 — 단독 작업자/짧은 작업은 안전\n'
  printf '  [B] 복구       — rm %s %s\n' "$FLAG" "$COUNTER"
  printf '  [C] 임계값 완화 — export CCK_HOOK_THRESHOLD=8 (응답당 다수 Edit 자주 발생 시)\n'
  printf '                  영구화: settings.json env 또는 shell rc에 추가\n'
else
  printf '  현재 정상 — 별도 조치 불필요\n'
  printf '  멀티파일 Edit이 잦아 자동 비활성화가 자주 발동한다면:\n'
  printf '    export CCK_HOOK_THRESHOLD=8  # 응답당 Edit 허용량 상향\n'
fi

# ── [참고] Stop 동작을 실제로 확인하려면 ─────────────────────
printf '\n[참고] Stop 훅을 능동 검증하려면 (mutate 가능 — 신중히):\n'
printf '  echo \"{\\\"stop_hook_active\\\": false}\" | bash %s/stop.sh\n' "$HOOKS_DIR"

exit 0
