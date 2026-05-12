---
name: skill-report
description: 프로젝트 메트릭 리포트 - throughput, quality, code, health 4축 분석. 사용자가 "리포트 생성해줘" 또는 /skill-report을 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(gh:*), Bash(python3:*), Read, Write, Glob, Grep
argument-hint: "[--full]"
complexity-hint: medium
---

# skill-report: 프로젝트 메트릭 리포트

## 실행 조건
- 사용자가 `/skill-report` 또는 "리포트 생성해줘" 요청 시
- `--full`: 프로젝트 전체 히스토리 (기본: 최근 7일 또는 마지막 리포트 이후)

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재 → 없으면 "/skill-init 먼저 실행" 안내
2. backlog.json 존재 + 유효 JSON

## 실행 플로우

### 1. 데이터 수집 (read-only, 상태 파일 수정 없음)

| 소스 | 수집 항목 |
|------|----------|
| backlog.json | Task 상태별 수량 (total/todo/in_progress/done/blocked/archived), type별 분포, skipped step 수 |
| completed.json | 완료 Task 수, 완료 시각 |
| execution-log.json | 실행 로그 항목 수 (존재 시) |
| `gh pr list` | 머지 PR (additions/deletions/reviews), 열린 PR |
| `git log` | 커밋 빈도, 타입 분포 |

### 2. 메트릭 분석 (4축)

#### 2.1 Throughput (처리량)
완료 Task 수, 평균 리드타임, 스텝 완료율, Task 처리 속도(Task/일), Task type별 분포 (feature/bug/chore/spike), Micro Task 비율 (micro:true / 전체)

#### 2.2 Quality (품질)
CRITICAL 비율, 수정 라운드 평균, 첫 리뷰 통과율, 리뷰 코멘트 밀도

#### 2.3 Code (코드)
PR 평균 크기, 커밋 빈도, PR 크기 분포 (S<100/M100~300/L300~500/XL500+), 커밋 타입 분포 (feat/fix/refactor/docs/test/chore), 스킵 비율 (skipped step / total step)

#### 2.4 Health (건강도)
오픈 Task, 블록 Task, Stale 워크플로우(30분+), 오래된 PR(3일+)

건강도 기준: 양호(블록0+Stale0+오래된PR0) / 주의(1~2) / 경고(3+)

### 3. 리포트 생성

`docs/reports/report-YYYY-MM-DD.md` 파일 생성.
필수 포함: 생성일/기간/모드, 4축 메트릭 테이블(값+추세↑↓→), 종합 분석, 권장 조치 체크리스트

### 4. 추세 비교

이전 리포트 존재 시 주요 지표 추세(↑↓→) 표시.

## 출력

필수 포함: 4축 핵심 지표 요약 테이블(축/핵심지표/값), 리포트 파일 경로, 주요 발견 2~3건, 권장 조치

## 주의사항
- 순수 읽기 전용 (상태 파일 수정 없음, execution-log에도 기록 안 함)
- 리포트 파일만 생성 (`docs/reports/`)
- `--full` 모드는 전체 히스토리 분석하므로 시간이 오래 걸릴 수 있음
