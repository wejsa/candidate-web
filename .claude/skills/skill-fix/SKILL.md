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
5. **fix 후보 이슈가 존재** (PR 리뷰 코멘트에서 확인). 호출 모드별 정의:
   - **auto-fix 모드** (`workflowState.fixLoopCount` ≥ 1 **AND** `workflowState.lastReviewDecision` = "REQUEST_CHANGES"): 정상 게시 CRITICAL 1개 이상. v2.3+ confidence 매트릭스에서 **강등된 CRITICAL은 fix 대상 아님**(SSOT — false-positive 무한 fix-redo 차단)
   - **수동 호출 모드** (그 외 — `/skill-fix {N}` 직접 호출, fixLoopCount=0, 또는 `lastReviewDecision`이 APPROVED/COMMENT인 경우): 정상 게시 CRITICAL 또는 **강등 CRITICAL** 중 1개 이상. 사용자가 명시 호출했다면 강등 항목도 수정 후보로 인정(skill-review-pr 강등 경고 헤더를 보고 결정한 경우)

> **모드 판정 SSOT**: fixLoopCount 단독으로는 직전 auto-fix 루프 잔재가 manual 호출을 오분류할 수 있음(예: 1회 fix→APPROVE 후 사용자가 강등 항목 수동 fix 시도). 그래서 `lastReviewDecision`을 AND 조건으로 묶어 "직전 결정이 REQUEST_CHANGES일 때만 auto-fix 모드"로 엄격 정의. APPROVED/COMMENT 이후 호출은 항상 수동 모드. `lastReviewDecision`은 skill-review-pr Step 6.5에서 갱신.

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

### 2. fix 후보 이슈 목록 파싱

PR 리뷰 코멘트에서 직접 파싱 (`gh api repos/{owner}/{repo}/pulls/{number}/comments`). 인라인 코멘트 라벨 형식의 **단일 진실 소스는 `skill-review-pr` SKILL.md Step 5 "인라인 코멘트 라벨 형식 (SSOT)"** — 본 Step의 정규식은 그 SSOT를 파싱 대상으로 가정한다. v2.3+ 강등 매트릭스 인지로 모드별 분기:

**파싱 정규식 (SSOT 기준)**:
- **정상 게시 CRITICAL**: 본문 첫 줄에 `**CRITICAL**` 볼드 토큰 매치 — regex `\*\*CRITICAL\*\*` (이모지 `🔴` 유무 무관). 레거시 호환으로 `[CRITICAL]` 대괄호 태그도 인정.
- **강등 CRITICAL**: 본문에 `[원래 CRITICAL · 강등]` 마커 매치 — regex `\[원래 CRITICAL\s*·\s*강등\]`. 라벨 자체는 `**MAJOR**`로 렌더되므로 **마커로만 식별**(라벨로는 정상 MAJOR와 구분 불가).

**auto-fix 모드** (사전 조건 #5 정의 — fixLoopCount ≥ 1 AND lastReviewDecision="REQUEST_CHANGES"):
- 정상 게시 CRITICAL만 매치 (위 `\*\*CRITICAL\*\*` 또는 `[CRITICAL]`).
- `[원래 CRITICAL · 강등]` 마커가 있는 항목은 **제외** (skill-review-pr SSOT — fix loop 진입 조건은 매트릭스의 "CRITICAL 게시" 행만, 강등은 false-positive 진동 차단 목적)

**수동 호출 모드** (그 외):
- 정상 게시 CRITICAL (위 `\*\*CRITICAL\*\*` 또는 `[CRITICAL]`).
- **강등 CRITICAL 추가**: `[원래 CRITICAL · 강등]` 마커를 포함하는 인라인 코멘트 (MAJOR 라벨로 렌더되지만 원래 CRITICAL). skill-review-pr 강등 경고 헤더(`⚠️ 강등된 CRITICAL N개`)를 보고 사용자가 수동 호출한 시나리오 지원
- 두 종류 모두 path, line, body 필드 추출. 각 이슈에 `isDemoted: true/false` 마커 부여(Step 6 커밋 메시지 ID prefix 분기 용도)

**모드 무관 공통 추출**: path, line, body 필드

### 3. 이슈별 코드 수정
각 CRITICAL 이슈: 파일 읽기 → 문제 분석 → 수정 작성 → Edit 적용

### 4. 빌드 검증
`project.json`의 `buildCommands.build` 우선 → `techStack` 기반 폴백 (spring→gradlew, node→npm, go→go build).
실패 시 수정 재시도 (최대 3회), 3회 실패 → 에러 보고 후 종료.

### 5. 테스트 검증
`project.json`의 `buildCommands.test` 우선 → `techStack` 기반 폴백.
실패 시 수정 재시도 (최대 3회), 3회 실패 → 에러 보고 후 종료.

### 6. 커밋 & 푸시
커밋: `fix: 코드 리뷰 피드백 반영` + 이슈별 ID 설명 + Co-Authored-By → push
- 정상 게시 CRITICAL: `[C{NNN}]` (예: `[C001] X에서 SQL injection 가능성 차단`)
- 강등 CRITICAL: `[H{NNN}(원래 CRITICAL · 강등)]` (예: `[H003(원래 CRITICAL · 강등)] Y의 락 누락`) — PR #76 ID 채번 규칙(강등은 H 채널 사용)과 일관
- 표기 SSOT: 위 두 형식만 사용. 회고/통계 grep 시 단일 패턴 보장.

**기존 PR 브랜치에서 작업** (새 브랜치 생성 금지)

### 6.5 실행 로그
execution-log.json에 `fix_completed` 기록 (prNumber, issueCount)

### 7. skill-review-pr 재호출 (루프 가드 적용)

| fix 횟수 | 재호출 | 설명 |
|----------|--------|------|
| 1회 (첫 수정) | `Skill tool: skill="skill-review-pr", args="{prNumber} --auto-fix"` | 재수정 기회 1회 더 |
| 2회 (최종) | `Skill tool: skill="skill-review-pr", args="{prNumber}"` (--auto-fix 없음) | CRITICAL 남으면 REQUEST_CHANGES |
| 3회 이상 | 호출 금지 | 루프 가드 발동 |

**수동 호출 + 강등 fix 시나리오**: 사용자가 강등 경고를 보고 `/skill-fix {N}` 수동 호출 → fix-up 후 재리뷰는 자동 체이닝 X(사용자가 결과를 확인하고 다시 트리거하는 흐름이 자연스러움). 본 케이스는 "1회 (첫 수정)" 분기를 사용하지 않고 종료 — 사용자가 `/skill-review-pr {N}` 명시 호출해 재리뷰.

## 출력

필수 포함: PR 번호, 수정 이슈 테이블(ID/파일/라인/설명/상태), 변경 사항(파일 수/라인), 빌드·테스트 결과, 커밋 SHA, 자동 재리뷰 안내

## 주의사항
- 반드시 기존 PR 브랜치에서 작업 (새 브랜치 생성 금지)
- 빌드/테스트 통과 필수
- 루프 가드 최대 2회: 3회째는 금지
- **v2.3+ 강등 매트릭스 인지**: auto-fix 모드는 게시 CRITICAL만, 수동 호출은 강등 CRITICAL도 포함. 모드 판정은 `workflowState.fixLoopCount`로 (≥1=auto, 0/undefined=수동). skill-review-pr이 자기 PR + 강등 가드로 chain 차단한 PR을 사용자가 수동 트리거할 때 본 분기가 강등 항목을 fix 대상으로 인정해 silent 격리 방지
