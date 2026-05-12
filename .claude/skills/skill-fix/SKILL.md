---
name: skill-fix
description: PR 수정 - CRITICAL 이슈 자동 수정. skill-review-pr --auto-fix에서 자동 호출되거나 사용자가 /skill-fix를 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(gh:*), Bash(./gradlew:*), Bash(npm:*), Read, Write, Edit, Glob, Grep
argument-hint: "{PR번호}"
complexity-hint: medium
---

# skill-fix: PR 수정

## 실행 조건
- skill-review-pr --auto-fix에서 CRITICAL 이슈 발견 시 자동 호출
- 또는 사용자가 `/skill-fix {번호}` 직접 호출

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재
2. backlog.json 존재 + 유효 JSON
3. PR 번호 지정됨
4. PR 존재 + OPEN 상태
5. CRITICAL 이슈가 존재 (PR 리뷰 코멘트에서 확인)

## 워크플로우 진행 표시
CLAUDE.md 진행 표시 프로토콜. fixLoopCount에서 현재 회차 N 확인 → "CRITICAL 이슈 자동 수정 중 (회차: N/2)"

## 워크플로우 상태 추적
CLAUDE.md 상태 추적 패턴. currentSkill="skill-fix"

**진입 시**: currentSkill="skill-fix", fixLoopCount={N} (1부터, 최대 2)
**완료 시**: currentSkill="skill-review-pr", lastCompletedSkill="skill-fix"

### fixLoopCount 로직
- skill-review-pr이 CRITICAL 발견 시 fixLoopCount 증가시켜 전달
- **3회째 CRITICAL 발견 시 skill-fix 호출하지 않고 즉시 중단 (루프 가드)**

## 실행 플로우

### 1. PR 브랜치 체크아웃
`gh pr checkout {number}`

### 2. CRITICAL 이슈 목록 파싱
PR 리뷰 코멘트에서 직접 파싱 (`gh api repos/{owner}/{repo}/pulls/{number}/comments`):
- `🔴 **CRITICAL**` 또는 `[CRITICAL]` 태그
- path, line, body 필드 추출

### 3. 이슈별 코드 수정
각 CRITICAL 이슈: 파일 읽기 → 문제 분석 → 수정 작성 → Edit 적용

### 4. 빌드 검증
`project.json`의 `buildCommands.build` 우선 → `techStack` 기반 폴백 (spring→gradlew, node→npm, go→go build).
실패 시 수정 재시도 (최대 3회), 3회 실패 → 에러 보고 후 종료.

### 5. 테스트 검증
`project.json`의 `buildCommands.test` 우선 → `techStack` 기반 폴백.
실패 시 수정 재시도 (최대 3회), 3회 실패 → 에러 보고 후 종료.

### 6. 커밋 & 푸시
커밋: `fix: 코드 리뷰 피드백 반영` + 이슈별 [C00N] 설명 + Co-Authored-By → push
**기존 PR 브랜치에서 작업** (새 브랜치 생성 금지)

### 6.5 실행 로그
execution-log.json에 `fix_completed` 기록 (prNumber, issueCount)

### 7. skill-review-pr 재호출 (루프 가드 적용)

| fix 횟수 | 재호출 | 설명 |
|----------|--------|------|
| 1회 (첫 수정) | `Skill tool: skill="skill-review-pr", args="{prNumber} --auto-fix"` | 재수정 기회 1회 더 |
| 2회 (최종) | `Skill tool: skill="skill-review-pr", args="{prNumber}"` (--auto-fix 없음) | CRITICAL 남으면 REQUEST_CHANGES |
| 3회 이상 | 호출 금지 | 루프 가드 발동 |

## 출력

필수 포함: PR 번호, 수정 이슈 테이블(ID/파일/라인/설명/상태), 변경 사항(파일 수/라인), 빌드·테스트 결과, 커밋 SHA, 자동 재리뷰 안내

## 주의사항
- 반드시 기존 PR 브랜치에서 작업 (새 브랜치 생성 금지)
- 빌드/테스트 통과 필수
- 루프 가드 최대 2회: 3회째는 금지
