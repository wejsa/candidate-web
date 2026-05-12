---
name: skill-rollback
description: 릴리스 롤백 - git revert 기반 안전한 릴리스/PR 롤백 + 감사 추적. 사용자가 "롤백해줘" 또는 /skill-rollback을 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(gh:*), Read, Write, Edit, Glob
argument-hint: "\"{태그 또는 PR번호}\""
complexity-hint: light
---

# skill-rollback: 릴리스 롤백

## 실행 조건
- `/skill-rollback v1.2.3` — 태그 기반 롤백
- `/skill-rollback #123` — PR 기반 롤백

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재
2. Clean working tree
3. main 브랜치 접근 가능
4. VERSION 파일 존재
5. Worktree 환경 차단 (`git-dir != git-common-dir` → STOP, 메인 레포에서 실행 안내)

## 실행 로그 기록
시작: execution-log.json에 `rollback_started` (target 포함)

## 실행 플로우

### 1. 타겟 식별
**태그 기반**: `git rev-parse --verify "v1.2.3"` → TARGET_SHA + merge commit 여부 확인
**PR 기반**: `gh pr view 123` → MERGED 확인 → mergeCommit SHA + merge 여부 확인

### 2. Revert 브랜치 생성
```bash
git fetch origin main && git checkout main && git pull origin main
git checkout -b "revert/${TARGET_LABEL}"
```

### 3. Git Revert 실행
- merge commit: `git revert "$TARGET_SHA" --mainline 1 --no-edit`
- 일반 commit: `git revert "$TARGET_SHA" --no-edit`
- 충돌 시: 충돌 파일 목록 + 수동 해결 안내

### 4. 빌드/테스트 검증
buildCommands 우선 → techStack 폴백 (skill-release와 동일 패턴)

### 5. Revert PR 생성
`git push -u origin "$BRANCH_NAME"` → `gh pr create --base main`
PR body 필수 포함: Summary, Reverted Changes (원본 정보, SHA), Reason, Test Plan

### 6. PR 머지
`gh pr merge $PR_NUMBER --squash --delete-branch`

### 7. 패치 버전 범프 + CHANGELOG
main checkout → VERSION patch 증가 → CHANGELOG.md에 Reverted/Fixed 섹션 삽입 → README.md 버전 업데이트

### 8. 릴리스 커밋 + 태그
```bash
git add VERSION CHANGELOG.md README.md
git commit -m "release: v{NEW_VERSION} revert - {target} 롤백

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION} - revert ${target}"
```

### 9. develop 백머지
```bash
git checkout develop && git pull origin develop && git merge main --no-edit
```
충돌: develop(최신) 우선, VERSION/CHANGELOG는 main 우선

### 10. Push all
`git push origin main && git push origin "v${NEW_VERSION}" && git push origin develop`

## 실행 로그 기록 (완료)
execution-log.json에 `rollback_completed`: target, revertSha, prNumber, version

## 출력 포맷
필수 포함: 대상 (target, SHA), Revert PR 번호, 이전/신규 버전, 태그, develop 백머지 결과, 다음 단계

## 주의사항
- `git revert` 사용 (히스토리 보존), `git reset`/`--force` 절대 금지
- PR 기반 감사 추적 (revert 사유/내용 기록)
- main 브랜치 직접 PR (`--base main`)
- develop 백머지 필수
- Worktree 환경 실행 불가
