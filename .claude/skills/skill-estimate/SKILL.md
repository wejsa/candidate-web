---
name: skill-estimate
description: 작업 복잡도 추정 - 5팩터 분석 + 과거 데이터 보정. 사용자가 "작업량 추정해줘" 또는 /skill-estimate를 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(gh:*), Bash(wc:*), Read, Glob, Grep
argument-hint: "<TASK-ID|--phase N|--sprint>"
complexity-hint: medium
---

# skill-estimate: 작업 복잡도 추정

## 실행 조건
- 사용자가 `/skill-estimate {TASK-ID}` 또는 "이 작업 얼마나 걸려?" 요청 시
- 사용자가 `/skill-estimate --phase {N}` 또는 "페이즈 N 분석해줘" 요청 시
- 사용자가 `/skill-estimate --sprint` 또는 "스프린트 플래닝 해줘" 요청 시

## 실행 모드

| 모드 | 트리거 | 대상 |
|------|--------|------|
| 단일 Task | `/skill-estimate TASK-001` | 지정 Task 복잡도 추정 |
| 페이즈 | `/skill-estimate --phase 1` | 해당 Phase의 모든 Task 요약 |
| 스프린트 | `/skill-estimate --sprint` | TODO 상태 Task 우선순위 + 추정 |

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재 → 없으면 "/skill-init 먼저 실행" 안내
2. backlog.json 존재 + 유효 JSON

## 5팩터 복잡도 분석

각 Task를 5가지 축으로 분석 (점수: 1/2/3/5/8):

### Factor 1: 코드 변경 규모 (Code Scope)
| 점수 | 기준 |
|------|------|
| 1 | 단일 파일, 10줄 미만 |
| 2 | 2~3개 파일, 50줄 미만 |
| 3 | 4~8개 파일, 200줄 미만 |
| 5 | 9~15개 파일, 500줄 미만 |
| 8 | 15개 이상, 500줄 이상 |

데이터 소스: `{TASK-ID}-spec.md`, backlog.json description, completed.json + git log (유사 과거 Task)

### Factor 2: 아키텍처 영향 (Architecture Impact)
1→기존 패턴 내, 2→새 기능 추가, 3→새 모듈 1개, 5→복수 모듈 상호작용, 8→아키텍처 패턴/DB 대규모 변경

### Factor 3: 의존성 위험 (Dependency Risk)
1→외부 없음, 2→안정 라이브러리, 3→새 외부 서비스 1개, 5→복수 외부 연동/버전 업그레이드, 8→핵심 인프라 변경

### Factor 4: 테스트 복잡도 (Test Complexity)
1→단위만, 2→단위+통합, 3→외부 모킹, 5→E2E/성능, 8→보안/장애 시나리오

### Factor 5: 도메인 복잡도 (Domain Complexity)
1→단순 CRUD, 2→비즈니스 규칙 1~2개, 3→상태 머신/복잡 검증, 5→트랜잭션/동시성, 8→컴플라이언스/멱등성

## 복잡도 점수 산출

총점 = Factor1~5 합산 (최소 5, 최대 40)

| 총점 | 등급 | 예상 스텝 수 |
|------|------|-------------|
| 5~10 | LOW | 1~2 스텝 |
| 11~18 | MEDIUM | 2~4 스텝 |
| 19~28 | HIGH | 4~6 스텝 |
| 29~40 | CRITICAL | 6~10 스텝 (Task 분할 권장) |

## 과거 데이터 보정

### completed.json 기반 학습
- createdAt/completedAt 타임스탬프로 소요 시간 산출
- 유사 규모(스텝 수) 과거 Task 검색 → 평균 스텝당 시간 → 보정
- 과거 데이터 없으면: 스텝당 1시간 기본 추정 + "기본 추정치" 안내

### git log 기반
과거 Task 커밋의 변경 규모 (additions/deletions) 참조

### execution-log.json (선택적)
존재 시 스킬 실행 이력 패턴 분석 (예: review REQUEST_CHANGES 빈도 → 품질 위험도)

## 출력

### 단일 Task 모드
필수 포함: Task 정보(ID/제목/Phase/우선순위), 5팩터 테이블(팩터/점수/근거), 결과(총점/등급/예상 스텝/소요 시간), 과거 보정 내역, 권장사항

### 페이즈 모드
필수 포함: 요약(Task 수/평균 복잡도/총 스텝/총 시간), Task별 추정 테이블, 위험 요소

### 스프린트 모드
필수 포함: TODO Task 우선순위 테이블(순위/Task/복잡도/스텝/시간), 권장 스프린트 구성(필수+선택), 의존 관계

## 데이터 소스 우선순위
1. completed.json — 핵심 (타임스탬프 기반)
2. backlog.json — 현재 Task 메타데이터
3. git log / gh pr view — 코드 변경 규모, PR 메트릭
4. execution-log.json — 선택적

## 주의사항
- 추정은 참고용이며 실제 소요 시간과 다를 수 있음
- 과거 데이터가 충분할수록 보정 정확도 향상
- CRITICAL 등급 Task는 Task 분할을 강력 권장
- 상태 파일은 읽기 전용 (수정하지 않음)
