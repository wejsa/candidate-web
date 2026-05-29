# .claude/hooks/tests/ — 훅 회귀 테스트 (Phase 1 Step 2)

> TFT 실패 시나리오 8개(`docs/v2/phase-1-tft-analysis.md §4`) 중 Step 2 범위(SessionStart/Stop)를 자동 검증한다. Step 3에서 PostToolUse 테스트 추가 예정.

## 실행

```bash
bash .claude/hooks/tests/run-all.sh           # 전체
bash .claude/hooks/tests/test-stop-recursion.sh  # 개별
```

각 테스트는 `/tmp/ack-hook-test-$$`에 격리된 작업 공간을 만든 후 훅 스크립트를 실행하고, 종료 시 자동 정리한다. 실제 `.claude/state/`는 건드리지 않는다.

## 커버 매트릭스

| 테스트 | TFT §4 시나리오 | 커버 |
|--------|---------------|------|
| test-stop-recursion.sh | 5 (stop_hook_active=true) | ✅ |
| test-atomic-write-parallel.sh | 6 (워크트리 2개 동시 Write) | ✅ |
| test-lock-expiry.sh | — (stop.sh 만료 잠금 해제) | ✅ |
| test-session-start-git.sh | 1,2,7 (jq 없음/비-git/구버전) | ✅ |
| test-continuation-plan.sh | — (Stop 디바운스/idle 스킵) | ✅ |
| test-hi04-checker.sh | — (HI-04 자가 검사 스크립트) | ✅ |

## 규약

- 테스트는 **훅과 동일한 R4 규칙**을 따른다: `exit 2` 금지, 실패 시 stderr + 종료 코드 1
- 테스트 러너는 CI(`.github/workflows/hook-tests.yml`)에서 shellcheck 이후 실행된다
