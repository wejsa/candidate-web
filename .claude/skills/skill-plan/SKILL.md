---
name: skill-plan
description: 계획 수립 - Task 선택 + 설계 분석 + 스텝 분리 계획. 사용자가 "다음 작업 가져와", "계획 세워줘" 또는 /skill-plan을 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Read, Write, Glob, Grep, Task, AskUserQuestion
argument-hint: "[taskId]"
complexity-hint: heavy
---

# skill-plan: 계획 수립

## 실행 조건
- 사용자가 `/skill-plan` 또는 "다음 작업 가져와" 요청 시
- 특정 Task 지정: `/skill-plan {taskId}`

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재 → 없으면 "/skill-init 먼저 실행" 안내
2. backlog.json 존재 + 유효 JSON
3. origin/develop 동기화: >5 뒤처짐 → STOP, 1-5 → 자동 merge

## 경량 점검
CLAUDE.md "경량 점검 프로토콜" 3단계 실행: ①PR-backlog 일치 ②Stale 감지 ③Intent 복구

## 워크플로우 진행 표시
CLAUDE.md 진행 표시 프로토콜. 현재 단계: "설계 분석 및 스텝 분리 중"

## 워크플로우 상태 추적
CLAUDE.md 상태 추적 패턴. currentSkill="skill-plan"

## 과거 학습 반영
1. `.claude/state/lessons-learned.json` 존재 확인 → 없으면 스킵
2. 현재 Task 도메인/키워드 관련 학습 필터링 (impact=high 우선, 최대 5건)
3. 설계 분석 + 스텝 분리에 반영, 계획 파일에 "참고 학습 항목" 섹션 추가

## 실행 플로우

### 0.5 잠금 자동 정리 (Lock Auto-cleanup)

Task 선택 전에 모든 `in_progress` Task를 스캔:

1. 각 Task의 `assignedAt` + (`lockTTL` ?? 3600) < 현재 시각인지 검사
2. 만료된 Task 발견 시:
   - `status` → `"todo"`, `assignee` → `null`, `assignedAt` → `null`, `lockedFiles` → `[]`
   - `workflowState` → `null`
   - `metadata.version` 1 증가
   - 로그: `🔓 잠금 만료 자동 해제: {TASK-ID} "{제목}" (만료: {N}분 전)`
3. 여러 Task 만료 시 모두 한 번에 처리 후 커밋+push
4. `status: paused` Task는 대상에서 제외 (일시정지는 의도적)

### 1. Task 선택
**자동 선택 기준** (taskId 미지정 시):
1. `status: todo` 중 `dependencies` 충족 + `lockedFiles` 충돌 없는 Task
2. `priority` 높은 순 → 같으면 `phase` 낮은 순
- 의존성 미충족 → `blocked` 표시
- 같은 파일 수정 중인 `in_progress` Task → 경고
- `status: paused` Task 감지 시 → "일시정지 Task {ID} 재개할까요?" 확인
  - 재개: `status → in_progress`, `pauseReason → null`, `pausedAt → null`
  - 유지: 다음 todo Task 선택

### 1.5 조기 잠금 (중복 선택 방지)
Task 선택 직후 **즉시** backlog.json 업데이트 + push:
- `status: "in_progress"`, `assignee: "{user}@{hostname}-{YYYYMMDD-HHmmss}"`, `lockTTL: 1800`, `lockedFiles: []`
- `metadata.version` 1 증가, 커밋: `chore: claim {TASK-ID}`
- CLAUDE.md 워크트리 프로토콜에 따라 push

**Push 실패 시**: pull --rebase → 해당 Task가 이미 in_progress면 로컬 취소 + 다음 Task 재선택
**Push 성공 확인 후에만** 다음 단계 진행. 미확인 상태 진행 금지.

### 2. 요구사항 확인
`docs/requirements/{taskId}-spec.md` 읽기

### 3.0 DB 설계 분석 (병렬)
agents.enabled에 "db-designer" 포함 시에만 실행.
Task tool (`run_in_background: true`)로 agent-db-designer 실행, 섹션 3 완료 후 결과 수거.

**에이전트 프롬프트 구성 (토큰 절감)**:
- 프롬프트에 포함: taskId, domain, spec 파일 경로
- 프롬프트에 포함하지 않음: spec 전체 내용, project.json 전체 (에이전트가 필요 시 자체 Read)

| 항목 | 값 |
|------|-----|
| timeout | 60초 |
| fallback | "⚠️ DB 설계 분석 불가" + 메인에서 직접 작성 |

### 3. 설계 분석
도메인 템플릿 참조 (`.claude/domains/{domain}/templates/` → `_base/templates/` 폴백):
- 3.1 컴포넌트 설계: 파일 목록, 역할, 패키지 구조
- 3.2 시퀀스 다이어그램
- 3.3 API 설계 (해당 시): 엔드포인트, 스키마, 에러 코드
- 3.4 데이터 모델: 엔티티/DTO, 관계

### 4. 스텝 분리 계획
**분리 기준**: 각 스텝이 독립 빌드/테스트 가능한 논리적 단위.
- 기본: project.json의 prLineLimit 미만
- **스텝 특성에 따라 prLineLimit 자동 설정** (50~1000):
  - DB 마이그레이션/설정 변경 → 100~200 자동 부여
  - 서비스+테스트 → 500~800 자동 부여
  - 테스트 일괄 추가/리팩토링 → 700~1000 자동 부여
  - 일반적인 스텝 → 미설정 (전역 값 폴백)
- 사용자는 검토/승인 시 조정 가능

**스텝 구조**:
```
Step N: {제목}
- 파일: {목록}, 참조 컨벤션: {컨벤션 파일명}, 예상 라인: {N}
- 라인 제한: {N} (미설정 시 전역 prLineLimit 적용)
- 내용: {설명}, 의존: {이전 Step}
```
참조 컨벤션: CLAUDE.md "도메인 컨벤션 참조" 트리거 테이블로 자동 식별

### 4.5 파일 충돌 검사
스텝별 수정 파일과 다른 in_progress Task의 lockedFiles 교집합 검사.
충돌 시: 순차 처리(권장) / 강제 진행(경고 포함) 선택지 제공

### 5. 계획 파일 생성
`.claude/temp/{taskId}-plan.md` — 포함: 요구사항 요약, 설계(컴포넌트/시퀀스/API/데이터모델), 스텝별 계획(파일/라인/내용/테스트), 리스크

### 6. 사용자 검토/승인 요청
승인 받을 때까지 개발 진행 금지.
- **Y**: 상태 업데이트 후 skill-impl 자동 호출
- **N**: 잠금 해제 (status→todo, assignee→null) + push + 종료
- **수정사항**: 해당 부분만 반영 후 재제시

### 7. 상태 업데이트 (승인 후)
> status/assignee는 1.5에서 설정됨. 여기서는 파일 잠금 + 스텝 정보만 갱신.

backlog.json 업데이트: assignedAt 리셋, lockedFiles, steps 배열 (prLineLimit 포함, 설정 시만), currentStep=1
- `metadata.version` 1 증가, `skill-backlog` 쓰기 프로토콜 준수
- **lockTTL 산정** (skill-backlog "동적 TTL"): ≤3파일→3600, 4-8→7200, ≥9→10800
- CLAUDE.md 워크트리 프로토콜에 따라 push. **push 성공 확인 후에만** skill-impl 호출
- push 충돌 시: lockedFiles 교집합 확인 → 충돌 있으면 사용자 경고

### 8. skill-impl 자동 호출
승인 시 반드시 `Skill tool: skill="skill-impl"` 호출. 직접 개발 금지.

## 출력
필수 포함: Task ID/제목/Phase/우선순위, 설계 요약, 스텝 테이블(Step/제목/예상라인/주요파일), 계획 파일 경로, 승인 선택지(Y/N/수정)

## 에러 복구
CLAUDE.md "에러 복구 프로토콜" 참조. 미존재 시 3회 재시도 후 사용자 보고.

## 주의사항
- 계획 파일은 Git 제외 (`.claude/temp/`)
- 승인 전 코드 작성 금지
- 각 스텝은 PR 생성 단위
