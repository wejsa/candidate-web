---
name: skill-merge-pr
description: PR 머지 - 승인된 PR을 Squash 머지하고 상태 업데이트. 사용자가 "PR 머지해줘" 또는 /skill-merge-pr을 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(gh:*), Read, Write, Glob, Skill
argument-hint: "{PR번호}"
complexity-hint: light
---

# skill-merge-pr: PR 머지

## 실행 조건
- 사용자가 `/skill-merge-pr {번호}` 또는 "PR {번호} 머지해줘" 요청 시

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재
2. backlog.json 존재 + 유효 JSON
3. PR 승인 상태: Approved (자기 PR은 승인 불필요 — 셀프 리뷰 코멘트 완료 확인)
4. CI 통과: 모든 체크 성공
5. 충돌 없음: Mergeable
6. Draft 아님
7. origin/develop 동기화: >5 뒤처짐 → STOP, 1-5 → 자동 merge

**자기 PR 감지**: `gh pr view --json author` vs `gh api user` → 같으면 reviewDecision 검사 스킵

## 경량 점검
CLAUDE.md "경량 점검 프로토콜" 3단계 실행: ①PR-backlog 일치 ②Stale 감지 ③Intent 복구

## 워크플로우 진행 표시
CLAUDE.md 진행 표시 프로토콜. 현재 단계: "PR 머지 및 상태 업데이트 중"

## 워크플로우 상태 추적
CLAUDE.md 상태 추적 패턴. currentSkill="skill-merge-pr". Task 완료 시 workflowState=null.

## 실행 플로우

### 1. PR 상태 확인
`gh pr view {N} --json title,state,reviewDecision,mergeable,headRefName,baseRefName,author`
검증 실패 시 원인 + 해결 방법 출력.

### 2. Squash 머지
CLAUDE.md 워크트리 프로토콜 참조:
- **일반 모드**: `gh pr merge {N} --squash --delete-branch`
- **워크트리 모드**: `gh pr merge {N} --squash` (NEVER --delete-branch)

### 3. 로컬 동기화
CLAUDE.md 워크트리 프로토콜의 "머지 후 동기화" 참조.

### 3.5 Post-Merge Health Gate

project.json의 healthCheck.autoRunOnMerge로 제어 (기본값: true. false 시 스킵).
project.json이 없으면 스킵.

1. /skill-health-check --quick 자동 실행
2. 결과 확인:
   - 모든 CRITICAL PASS → 정상 진행
   - CRITICAL FAIL → WARNING 출력:
     "⚠️ 머지 후 health check에서 CRITICAL 이슈 발견: {이슈 목록}"
     "즉시 수정 필요. /skill-health-check로 상세 확인하세요."
   - WARNING은 머지를 롤백하지 않음 (이미 완료). 알림만 제공.
3. 점수 추세 확인 (health-history.json이 있고 이전 기록이 있으면):
   - health-history.json이 없거나 이전 기록이 없으면 추세 비교를 스킵하고 현재 결과만 표시한다.
   - 10점 이상 하락 → "📉 Health score가 {이전}점 → {현재}점으로 하락했습니다."

### 4. 상태 업데이트
`skill-backlog` 쓰기 프로토콜 준수 (metadata.version +1, JSON 검증).
step status → "merged", mergedAt 기록, currentStep 증가.

### 5. Task 완료 처리 (마지막 스텝)
**원자적 다중 파일 업데이트 프로토콜:**

#### 5.0 Intent 파일 생성 (복구 지점)
모든 상태 변경 전 `.claude/temp/{taskId}-complete-intent.json` 생성:
```json
{
  "taskId": "{taskId}", "action": "task_complete", "timestamp": "{시각}",
  "prNumber": "{N}", "stepNumber": "{N}",
  "pending": ["completed.json", "backlog.json", "execution-log.json", "plan-file"],
  "done": []
}
```

#### 5.1 completed.json 추가 (데이터 보존 우선)
metadata.version 읽기 (미존재 시 초기 구조 생성) → task entry 추가 → version +1 → JSON 검증

#### 5.2 backlog.json: status→"done", completedAt 기록

#### 5.3 교차 검증: backlog done - completed 차집합 → 누락 시 자동 복구

#### 5.4 계획 파일 삭제: `rm .claude/temp/{taskId}-plan.md`

#### 5.5 Phase 자동 갱신: 해당 phase 전체 done → phase status="done"

#### 5.6 커밋 & 푸시
CLAUDE.md 워크트리 프로토콜 참조. push 전 develop 동기화 필수.
단일 커밋: `chore: {taskId} 완료 처리`
push 충돌: 서로 다른 Task 모두 유지, metadata.version = max + 1, 재시도 최대 2회.

#### 5.7 워크트리 → develop 동기화 (워크트리 전용)
CLAUDE.md 워크트리 프로토콜의 "상태 파일 반영" 참조. 메인 리포 develop에 cp + 커밋 + push.

#### 5.8 Intent 파일 삭제
모든 커밋 완료 후에만 삭제.

#### Intent 기반 복구 (세션 재개 시)
`.claude/temp/*-complete-intent.json` 존재 시: pending 항목 각각 상태 확인 → 미완료 작업 실행 → 커밋 → intent 삭제

### 5.5 실행 로그
머지: action="merged", Task 완료: action="task_completed"

### 6. 다음 스텝 자동 진행
- 남은 스텝 있음: `Skill tool: skill="skill-impl", args="--next"`
- 마지막 스텝: Task 완료 처리 후 종료
- 직접 개발 금지. 반드시 Skill tool 사용.

## lockedFiles 해제
- 머지된 파일 → lockedFiles에서 제거
- 다음 스텝 있음: currentStep 증가, 다음 스텝 files는 유지
- 마지막 스텝: lockedFiles 전체 해제, assignee/assignedAt 제거, status="done"

## 출력
필수 포함: PR 번호/제목/브랜치/머지방식, Task 진행(Step N/M, 남은 스텝), 다음 자동 스킬 또는 Task 완료 요약

## 에러 복구
CLAUDE.md "에러 복구 프로토콜" 참조. 미존재 시 3회 재시도 후 사용자 보고.

## 주의사항
- 자기 PR은 승인 조건 스킵 후 머지 허용
- Squash 머지만 사용
- Task 완료 시 상태 파일 커밋 필수
