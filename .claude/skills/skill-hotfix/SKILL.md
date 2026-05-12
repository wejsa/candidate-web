---
name: skill-hotfix
description: main 긴급 수정 - 핫픽스 브랜치 + 보안 리뷰 + 패치 릴리스 + develop 백머지. 사용자가 "긴급 수정해줘" 또는 /skill-hotfix를 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(gh:*), Bash(./gradlew:*), Bash(npm:*), Read, Write, Edit, Glob, Grep
argument-hint: "\"{긴급 수정 설명}\""
complexity-hint: medium
---

# skill-hotfix: main 긴급 수정

## 실행 조건
- `/skill-hotfix "설명"` 또는 "긴급 수정해줘: 설명" 요청 시
- main 브랜치 장애/보안 이슈 발생 시

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재
2. Clean working tree
3. main 브랜치 접근 가능
4. VERSION 파일 존재
5. Worktree 환경 차단 (`git-dir != git-common-dir` → STOP, 메인 레포에서 실행 안내)

## 실행 로그 기록
시작: execution-log.json에 `hotfix_started` (description 포함)

## 실행 플로우

### 1. Hotfix 번호 생성
기존 `hotfix/HOT-*` 브랜치에서 최대 번호 + 1 → `HOT-{NNN}`

### 2. Hotfix 브랜치 생성
```bash
git fetch origin main && git checkout main && git pull origin main
git checkout -b "hotfix/${HOTFIX_ID}-${DESCRIPTION_SLUG}"
```

### 3. 코드 수정
수정 설명 분석 → 관련 코드 탐색 (Glob, Grep, Read) → 수정 (Edit, Write)
원칙: 최소한의 변경만 수행

### 4. 빌드/테스트 검증
buildCommands 우선 → techStack 폴백 (skill-release와 동일 패턴)

### 5. 커밋
`git add -A` → `hotfix: {HOTFIX_ID} - {수정 설명}` + Co-Authored-By

### 6. PR 생성 (main 대상)
`git push -u origin "$BRANCH_NAME"` → `gh pr create --base main`
PR body 필수 포함: Summary, Root Cause, Fix, Test Plan

### 7. 보안 리뷰 (최소 리뷰)
Task tool로 pr-reviewer-security 서브에이전트 실행
CRITICAL 발견 → 수정 후 재리뷰 / CRITICAL 없음 → 머지 진행

### 8. Squash 머지
`gh pr merge $PR_NUMBER --squash --delete-branch`

### 9. 패치 버전 범프
main checkout → VERSION patch 증가

### 10. CHANGELOG + README 업데이트
CHANGELOG.md: `## [{NEW_VERSION}]` Fixed 섹션 삽입 ([Unreleased]와 이전 버전 사이)
README.md: 제목 버전 업데이트

### 11. 릴리스 커밋 + 태그
```bash
git add VERSION CHANGELOG.md README.md
git commit -m "release: v{NEW_VERSION} hotfix - {수정 설명}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION} - hotfix"
```

### 12. develop 백머지
```bash
git checkout develop && git pull origin develop && git merge main --no-edit
```
충돌: develop(최신) 우선, VERSION/CHANGELOG는 main(hotfix) 우선

### 13. Push all
`git push origin main && git push origin "v${NEW_VERSION}" && git push origin develop`

## 실행 로그 기록 (완료)
execution-log.json에 `hotfix_completed`: hotfixId, prNumber, version, description

## 출력 포맷
필수 포함: HOTFIX_ID, 수정 설명, PR 번호, 이전/신규 버전, 태그, develop 백머지 결과, 다음 단계 (배포 확인, 모니터링)

## 주의사항
- main에서 직접 분기하는 유일한 스킬
- PR은 반드시 `--base main`
- 최소한의 변경 (긴급 수정 원칙)
- develop 백머지 필수
- Worktree 환경 실행 불가
- 보안 리뷰만 수행 (전체 리뷰 대신 빠른 머지 우선)
- 롤백 필요 시: `/skill-rollback v{버전}` 안내
