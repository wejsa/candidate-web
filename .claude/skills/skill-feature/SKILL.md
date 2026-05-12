---
name: skill-feature
description: 기능 기획 - 요구사항 정의 + 백로그 Task 등록. 사용자가 "새 기능 기획해줘" 또는 /skill-feature를 요청할 때 사용합니다.
disable-model-invocation: true
allowed-tools: Bash(git:*), Read, Write, Glob, Grep, AskUserQuestion
argument-hint: "[기능명]"
complexity-hint: medium
---

# skill-feature: 기능 기획

## 실행 조건
- 사용자가 `/skill-feature {기능명}` 또는 "새 기능 기획해줘" 요청 시
- 기능명 없이 호출 시 기능 추천

## 워크플로우 진행 표시
CLAUDE.md 진행 표시 프로토콜. 워크플로우 시작점: "새 워크플로우 시작 → plan → impl → review → merge 자동 진행"

## 실행 플로우

### 1. 기능 분석
- 범위/목적 파악, 기존 코드 분석, 기술적 실현 가능성
- 도메인 참고자료 확인: project.json→domain.json keywords→관련 문서 탐색, _base/conventions/ 컨벤션 확인

### 2. 중복 확인
backlog.json에서 유사 Task 확인 → 병합 또는 별도 생성 여부 확인

### 2.5. 통신 방식 확인
기능 분석 결과 실시간/양방향/스트리밍 요구사항이 감지되면 AskUserQuestion으로 프로토콜 확인:
- **REST** — 단방향 요청/응답 (기본값)
- **WebSocket** — 양방향 실시간 (채팅, 알림, 협업 에디터)
- **SSE** — 서버→클라이언트 단방향 스트림 (피드, 진행률)
- **gRPC** — 고성능 서비스 간 통신

선택 결과를 spec의 `기술 스펙 > 통신 방식`과 `비기능 요구사항 > 보안`에 반영.

### 3. 요구사항 문서 생성
`docs/requirements/{taskId}-spec.md` — 필수 섹션: 개요, 목적, 기능 요구사항(FR-NNN/설명/우선순위/수용기준), 비기능 요구사항(성능/보안/확장성), 기술 스펙(영향범위/의존성/통신방식/API변경), 테스트 계획, 참고자료

### 4. 사용자 검토/승인 요청
승인 받을 때까지 진행하지 않음.

### 5. 백로그 등록
승인 후 backlog.json에 Task 추가 (id, title, description, status=todo, priority, phase, specFile, dependencies, steps=[], currentStep=0)

### 6. 커밋 & 푸시
CLAUDE.md 워크트리 프로토콜 참조.
커밋: `feat: {taskId} 요구사항 정의 - {기능명}`

### 7. skill-plan 자동 호출
"Y" 승인 시 반드시 `Skill tool: skill="skill-plan", args="{taskId}"` 호출.
직접 설계 진행 금지.

## Task ID 생성 규칙
`{PREFIX}-{번호}` — PREFIX: `project.json`의 `conventions.taskPrefix` (기본: TASK), 번호: `metadata.lastTaskNumber + 1` (3자리 패딩)

## 기능 추천 (기능명 없이 호출 시)
코드베이스 분석 → 누락 기능 식별 → 개선 영역 → 우선순위와 함께 3-5개 추천

## 출력
필수 포함: Task ID/기능명/Phase/우선순위/예상 스텝, 요구사항 문서 경로, 승인 선택지(Y→백로그 등록+skill-plan / N→수정)

## 주의사항
- 요구사항 문서는 반드시 사용자 승인 후 백로그 등록
- 중복 Task 생성 방지
- Phase는 프로젝트 현황에 맞게 자동 추천 (사용자 변경 가능)
