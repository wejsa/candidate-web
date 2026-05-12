# .claude/SECURITY.md — 자동 실행 경고

> **중요**: `.claude/` 하위의 일부 파일은 **Claude Code 세션에서 자동 실행**됩니다. 본 문서는 그 위험과 방어 장치를 요약합니다.

## 자동 실행 대상

| 파일/디렉토리 | 발동 시점 | 발동 주체 | 실행 주기 |
|-------------|---------|---------|---------|
| `.claude/settings.json` `hooks.SessionStart[].hooks[].command` | Claude Code 세션 시작 | 본 저장소 contributor 모두 | 세션당 1회 |
| `.claude/settings.json` `hooks.PostToolUse[].hooks[].command` | Edit/Write 툴 호출 직후 | 〃 | 매 Write/Edit |
| `.claude/settings.json` `hooks.Stop[].hooks[].command` | Claude 응답 완료 시마다 | 〃 | 매 턴 |
| `.claude/hooks/**/*.sh` | 위 hooks 배열에 등록된 경우 | 〃 | 〃 |

**결과**: 악성 훅이 PR에 섞여 머지되면 **모든 clone 사용자의 다음 세션에서 실행**됩니다. 네트워크/파일 시스템/자격증명 접근이 전부 수반 가능.

## 방어 장치 (Phase 1)

1. **CODEOWNERS 게이팅** — `.github/CODEOWNERS`에 `.claude/settings.json`, `.claude/hooks/`, `.claude/schemas/`를 보안 오너로 등록. PR 생성 시 자동 리뷰 요청.
2. **스키마 화이트리스트** — `project.schema.json` `hookMatcher`에서 허용 이벤트/필드만 통과. `patternProperties`로 v2.1+ 공식 이벤트만 확장.
3. **비블로킹 규칙** — `.claude/hooks/README.md` 규정: `exit 2`/`set -e` 금지, 대화형 프롬프트 차단 env 강제.
4. **Hook Integrity Audit (Step 5 예정)** — `skill-health-check` 카테고리 `hook-safety`가 다음을 정적 검사:
   - HI-01 (CRITICAL): 위험 패턴 (`rm -rf`, `sudo`, `curl | sh`, `git reset --hard`, `git push --force`)
   - HI-02 (CRITICAL): 외부 스크립트/URL 참조
   - HI-03 (MINOR): `project.schema.json` 준수
   - HI-04 (MAJOR): `exit 2`/`set -e` 사용
5. **CI 검증** — `.github/workflows/schema-validation.yml`이 매 PR에서 스키마/fixtures/`settings.json` 구문 검증.

## 리뷰어 체크리스트

`.claude/settings.json` 또는 `.claude/hooks/` 변경 PR 리뷰 시:

- [ ] 추가된 `command`가 `$CLAUDE_PROJECT_DIR/.claude/hooks/` 내부 경로인가?
- [ ] 위험 패턴이 포함되지 않았는가? (특히 `rm`, `curl`, `wget`, `sudo`, `git reset/push --force`)
- [ ] 외부 URL/파일 시스템 경로 참조는 없는가?
- [ ] 훅 스크립트에 `exit 2` 또는 단독 `set -e`는 없는가?
- [ ] `description` 필드에 훅 목적이 명시되어 있는가? (감사 추적)
- [ ] CI의 `Schema Validation` workflow가 통과했는가?

## 긴급 비활성화

모든 훅을 즉시 중단:

```bash
# 1. 개인 수준
echo '{"disableAllHooks": true}' > ~/.claude/settings.json

# 2. 프로젝트 수준 (임시)
touch .claude/state/hook-disabled.flag   # PostToolUse만 (Step 3 이후)

# 3. 영구 제거 (PR로)
jq '.hooks = {"SessionStart":[],"PostToolUse":[],"Stop":[]}' .claude/settings.json > /tmp/s.json && mv /tmp/s.json .claude/settings.json
```

## 보안 이슈 신고

`.claude/` 하위의 보안 결함 발견 시 Public Issue 대신 비공개 경로로 신고 (repo Owner에게 직접 DM 또는 Security Advisories 기능 활용).
