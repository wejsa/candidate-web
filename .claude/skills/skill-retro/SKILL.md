---
name: skill-retro
description: 완료 Task 회고 - 분석 리포트 생성 + 체크리스트/컨벤션 학습 반영. 사용자가 "회고 해줘" 또는 /skill-retro를 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(gh:*), Read, Write, Edit, Glob, Grep, AskUserQuestion
argument-hint: "[TASK-ID|--summary|--lessons [list|search {keyword}|top]]"
complexity-hint: medium
---

# skill-retro: 완료 Task 회고

## 실행 조건
- `/skill-retro` — 최근 완료 1개 Task
- `/skill-retro {TASK-ID}` — 지정 Task
- `/skill-retro --summary` — completed.json 전체 통합 분석
- `/skill-retro --lessons [list|search {keyword}|top]` — lessons-learned.json 관리

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재 → 없으면 "/skill-init 먼저 실행" 안내
2. completed.json 존재 + 유효 JSON → 파싱 실패 시 "/skill-validate --fix 실행" 안내
3. 완료된 Task 1건 이상 존재

## 실행 플로우

### 1. 대상 Task 식별
- 기본 모드: completed.json에서 completedAt 최신 Task
- 특정 Task: 인수 TASK-ID가 completed.json에 존재 확인
- 전체 요약 (--summary): completed.json 전체 대상 통합 분석

### 2. 데이터 수집 (read-only, 상태 파일 수정 없음)
- completed.json에서 Task 정보
- execution-log.json에서 해당 Task 이벤트 (파일 존재 시)
- `gh pr list --state merged --search "$TASK_ID"` — PR 리뷰/코멘트
- `git log --all --oneline --grep="$TASK_ID"` — 커밋 이력
- `docs/requirements/{TASK_ID}-spec.md` (존재 시)

### 3. 분석 (5축)
- **Speed**: 총 소요 시간, 스텝별 시간, PR 리뷰 대기, 병목 식별
- **Quality**: CRITICAL 이슈 수, 수정 라운드 수, 첫 리뷰 통과율, PR 코멘트 수
- **Patterns**: 반복 이슈 유형, 자주 수정된 파일, 반복 지적 항목, 스킬 실행 순서
- **Decisions**: 설계 결정 요약, 트레이드오프, 기술 부채 여부
- **Lessons**: Keep / Improve / Learn / Try

### 4. 리포트 생성
- `docs/retro/{TASK-ID}-retro.md` 생성 (mkdir -p docs/retro)
- 필수 포함: 기본 정보 테이블 (Task ID, 제목, 시작/완료일, 소요 시간, 스텝/PR 수), 5축 분석 결과, Action Items
- 전체 요약 모드: `docs/retro/summary-YYYY-MM-DD.md` — 통계, 공통 패턴, 주요 교훈, 권장 개선 사항

### 5. 학습 반영

#### 5.1 반복 패턴 감지
- 동일 유형 이슈 2회+ 발생, 리뷰 동일 항목 2회+ 지적, 다른 Task에서 동일 실수 반복

#### 5.2 체크리스트/컨벤션 수정 제안
대상: `_base/checklists/*.md`, `{domain}/checklists/*.md`, `_base/conventions/*.md`
**반드시 AskUserQuestion 승인 후에만 파일 수정** (전체 승인 / 선택적 승인 / 반영 안 함)
CLAUDE.md는 절대 수정 금지.

#### 5.3 lessons-learned.json 저장
- `.claude/state/lessons-learned.json` 없으면 빈 구조 생성
- Lessons 섹션에서 학습 항목 추출 → 기존 중복 검사 (title+category)

**Secrets 필터 (저장 직전, 신규 항목만 — Phase 7 Step 2)**:
- `_base/health/secrets-patterns.json` `common.hardcoded` (SEC-S01~S05) 로드
- 신규 lesson `description` 정규식 매칭. 다중 패턴 매칭 시 모두 표시 후 **lesson 단위 단일 옵션** 선택 (개별 패턴 선택 불가)
- 매칭 시 AskUserQuestion (default = 거부):
  - **거부**: lesson 저장 스킵 + execution-log에 `lesson_rejected_secrets` 기록. dedup key = `title+category` — 동일 lesson 재출현 시 자동 재거부 (사용자 피로 방지)
  - **마스킹 후 저장**: 매칭 부분을 `***MASKED-{SEC-ID}***`로 치환. 예: `api_key="AbCd1234..."` → `api_key=***MASKED-SEC-S01***`
  - **강행 저장**: 안티패턴 *예시* 등 의도된 경우 그대로 저장 (사용자 책임). 이후 CI `validate-lessons-learned` 통과 — Step 1 D2 개정으로 validator는 secrets 검사를 skill-retro 레이어로 위임
- **비대화형 환경 판별**: `CI=true` 환경변수 또는 stdout이 TTY 아님 → AskUserQuestion 불가 → 자동 거부 + execution-log에 `lesson_rejected_secrets_noninteractive` 기록. ⚠️ CI 자동 회고 시 학습 손실 가능성 — 사용자 검토 안내 출력

- 중복: appliedCount 증가 + updatedAt 갱신 / 신규: L-{NNN} ID로 추가
- lesson 스키마(SSOT: [`schemas/lessons-learned.schema.json`](../../schemas/lessons-learned.schema.json)): `{id, taskId, category (quality|performance|architecture|process|security), title, description, impact (high|medium|low), tags, appliedCount, createdAt, updatedAt}`
- metadata.version 1 증가 + updatedAt 갱신
- 저장 후 `.claude/state/lessons-learned.json`은 schema 자동 검증 대상 (CI `validate-lessons-learned`)

### 6. 실행 로그 기록
execution-log.json에 `retro_completed` 항목 추가. 체크리스트/컨벤션 수정 시 `checklist_updated` 추가.

## 출력 포맷
- 개별 회고: 필수 포함: Task 요약 (ID, 제목, 소요 시간, 품질 점수), 주요 교훈, 리포트 경로, 학습 반영 결과
- 전체 요약: 필수 포함: 통계 (완료 수, 평균 소요 시간, CRITICAL 발생률), 리포트 경로

## --lessons 관리 명령어

### Impact 권장 임계값 (SSOT — `schemas/lessons-learned.schema.json` description)
- `appliedCount >= 5` → **high** 권장
- `appliedCount >= 3` → **medium** 권장
- `appliedCount < 3` → **low** 권장

> 임계값은 권장이며 사용자가 수동으로 impact를 override할 수 있다. list/top 출력 시 현재 impact ≠ 권장 시 `(권장: Y)` 표기.

### list
전체 학습 항목 카테고리별 테이블 출력 (ID, 제목, 영향도, 적용 횟수, 출처 Task).
영향도 컬럼은 `impact (권장: Y)` 형식 — 현재 impact와 권장이 일치 시 `(권장: Y)` 생략.

### search {keyword}
title, description, tags 대상 검색 → 매칭 테이블 출력 (list 동일 포맷)

### top
appliedCount 상위 5개 출력 (list 동일 포맷)

파일 미존재 시: "학습 항목이 없습니다. `/skill-retro` 먼저 실행하세요."

## 주의사항
- 데이터 수집은 읽기 전용 (backlog.json, completed.json 수정 없음)
- 체크리스트/컨벤션 수정은 반드시 사용자 승인 후에만
- CLAUDE.md 수정 금지
- execution-log 파일 미존재 시 `[]`로 생성, 500건 초과 시 아카이브
