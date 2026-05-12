---
name: skill-status
description: 프로젝트 상태 확인 - 현재 작업 진행상황, 백로그 요약, Git 상태, 시스템 건강 점검. 사용자가 "상태 확인해줘" 또는 /skill-status를 요청할 때 사용합니다.
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(gh:*), Bash(python3:*), Read, Glob
argument-hint: "[--health [--fix]|--locks]"
complexity-hint: light
---

# skill-status: 프로젝트 상태 확인

## 실행 조건
- 사용자가 `/skill-status` 또는 "상태 확인해줘" 요청 시

## 명령어 옵션
```
/skill-status                  # 기본 상태 확인
/skill-status --locks          # 병렬 작업 잠금 현황 포함
/skill-status --health         # 시스템 건강 점검
/skill-status --health --fix   # 건강 점검 + Orphan Intent 자동 정리
```

## 실행 플로우

### 1. Git 상태
`git branch --show-current`, `git status --short`, `git log --oneline -5`

### 2. 프로젝트 설정
project.json: 도메인, 기술 스택, 활성 에이전트, Kit 버전 (kitVersion, 미기록 시 "미설정")

### 3. 백로그 상태
backlog.json: todo/in_progress/done/blocked/archived 수량 + 진행 중 Task 상세 (ID, 제목, 현재 스텝)
archived 수량은 별도 표시 (활성 Task 집계에서 제외)

### 4. 계획 파일 확인
`.claude/temp/` 진행 중 계획 파일 확인

### 4.5 워크플로우 상태 점검
in_progress Task의 workflowState 확인 → Stale 감지 (updatedAt 30분+ 경과)
Stale 감지 시 복구 안내: `/skill-impl` (재개) 또는 `/skill-backlog update {ID} --status=todo` (초기화)

### 5. 활성 PR 상태
`gh pr list --state open` → 테이블 (PR, 제목, 브랜치, 리뷰, CI)

### 5.5 시스템 건강 점검 (--health)

점검 항목:
- JSON 유효성: `.claude/state/*.json`, `_registry.json` 파싱 검증
- 필수 파일: project.json, _registry.json, 스키마 2개, CLAUDE.md.tmpl, CLAUDE.md
- 스킬 디렉토리: `.claude/skills/*/SKILL.md` 완전성
- Git 원격 동기화: `git fetch --dry-run`
- 도메인 레지스트리 정상 여부
- backlog-completed 정합성: backlog done Task와 completed.json 비교 → 불일치 시 경고
- Orphan Intent: `.claude/temp/*-complete-intent.json` 검색 → 발견 시 pending 배열 표시

문제 발견 시 원인+해결방법 출력 (예: `/skill-validate --fix`, `git pull origin develop`)

#### 에스컬레이션 안내
점검 결과에서 3개 이상 경고가 발견되면 출력 하단에 안내:
"💡 심층 검진이 필요할 수 있습니다: /skill-health-check"

#### 검진 주기 안내
health-history.json이 존재하고 project.json의 healthCheck.suppressReminder가 true가 아니면, 마지막 전체 검진(mode가 fix/quick-fix가 아닌) 날짜를 확인한다.
- 7일 이상 경과: "📅 마지막 건강 검진이 {N}일 전입니다. /skill-health-check 권장"
- 14일 이상 경과: "⏰ 건강 검진이 {N}일간 미실행. /skill-health-check --fix 권장"
- health-history.json이 없거나 기록이 없으면: 안내하지 않음

#### --health --fix: Orphan Intent 자동 정리
- 대상: 생성 후 30분+ 경과 intent 파일 (python3 mtime 기반 필터링)
- 정리 플로우 (AskUserQuestion 없이 자동):
  1. pending 배열 순회 → completed.json 누락 보충, backlog done 전환, temp 계획 파일 삭제
  2. intent 파일 삭제
  3. 결과 테이블 출력
- execution-log에 `orphan_intent_cleanup` 액션 기록

### 6. 다음 단계 추천

| 우선순위 | 조건 | 추천 |
|---------|------|------|
| 1 | workflowState.currentSkill 존재 | 해당 스킬 + autoChainArgs |
| 2 | PR APPROVED | `/skill-merge-pr {prNumber}` |
| 3 | PR CHANGES_REQUESTED | `/skill-fix {prNumber}` |
| 4 | PR 리뷰 미완료 | `/skill-review-pr {prNumber}` |
| 5 | in_progress + stale 30분+ | 복구 안내 |
| 6 | in_progress Task | `/skill-impl` |
| 7 | todo Task | `/skill-plan` |
| 8 | 모든 Task done | `/skill-feature "기능명"` |

위에서 아래 순 첫 매칭 적용. 추천 1개 강조 + 기타 1-2개 추가 안내.
데이터 소스: backlog.json(workflowState), `gh pr list`(reviewDecision), execution-log.json

### 7. 실행 로그 확인
execution-log.json 존재 시 최근 10건 테이블 (시각, Task, 스킬, 액션, 상세)

### --locks: 병렬 작업 현황
in_progress Task 테이블: Task ID, 제목, 담당자, 스텝, 잠금 파일 수, 상태
잠금 상세: 각 Task의 할당 시각, 잠금 파일 목록

| 상태 | 조건 | 아이콘 |
|------|------|--------|
| 계획 중 | lockedFiles 비어있음 | 🟡 |
| 정상 | 남은시간 > 30분 | 🔄 |
| 만료임박 | 남은시간 <= 30분 | ⚠️ |
| 만료 | lockTTL 초과 (동적 1-3시간) | 🔴 |

## 실행 로그 프로토콜

### 형식
`.claude/state/execution-log.json` (append-only JSON array): `{timestamp, taskId, skill, action, details}`

### 스킬별 action

| 스킬 | action | details |
|------|--------|---------|
| skill-impl | started, pr_created | stepNumber, prNumber |
| skill-review-pr | review_started, approved, request_changes, subagent_failed | prNumber, criticalCount, failedAgent 등 |
| skill-fix | fix_started, fix_completed | prNumber, issueCount |
| skill-merge-pr | merge_started, merged, task_completed | prNumber, stepNumber |
| skill-retro | retro_started, retro_completed, checklist_updated | reportFile, files |
| skill-hotfix | hotfix_started, hotfix_completed | description, hotfixId, prNumber, version |
| skill-rollback | rollback_started, rollback_completed | target, revertSha, prNumber, version |
| skill-status | orphan_intent_cleanup | method, pendingRecovered, intentFile |

### 쓰기/동시성 규칙
- append-only, 파일 미존재 시 `[]` 생성, 500건 초과 시 아카이브
- 동시 쓰기: 기존 항목 수정/삭제 금지, push 충돌 시 pull --rebase 후 로컬 entry만 재추가

### 아카이브 로테이션
500건 초과 시: 최근 200건 유지, 나머지 `execution-log-archive-{YYYYMMDD}.json`으로 이동, 30일+ 아카이브 삭제

## 주의사항
- 기본 모드는 읽기 전용, --health --fix만 상태 파일 수정
- 상태 파일 없으면 초기 상태로 간주
- 문제 발견 시 `.claude/docs/troubleshooting.md` 참조 안내
