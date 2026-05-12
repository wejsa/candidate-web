---
name: skill-create
description: 커스텀 스킬 생성 - SKILL.md 스캐폴딩 + CLAUDE.md 자동 등록. 사용자가 "스킬 만들어줘" 또는 /skill-create를 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(mkdir:*), Bash(ls:*), Read, Write, Edit, Glob, Grep, AskUserQuestion
argument-hint: "<name> [description]"
complexity-hint: light
---

# skill-create: 커스텀 스킬 생성

## 실행 조건
- 사용자가 `/skill-create {name} "{description}"` 또는 "커스텀 스킬 만들어줘" 요청 시

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재 → 없으면 "/skill-init 먼저 실행" 안내
2. CLAUDE.md 존재
3. 스킬명 인수 존재

## 인수 파싱
`/skill-create <name> [description]`
- name: 영문 소문자+하이픈 `[a-z0-9-]`, `skill-` 접두사 자동 추가 (이미 있으면 유지)
- description: 생략 시 AskUserQuestion으로 수집

## 실행 플로우

### Step 1: 중복 검사
- `.claude/skills/custom/skill-{name}` 존재 → 덮어쓰기 여부 확인
- `.claude/skills/skill-{name}` (빌트인) 존재 → "이름 충돌" 안내 후 종료

### Step 2: 스킬 정보 수집
description 미제공 시 AskUserQuestion:
- 스킬 설명 (한 줄)
- 도구 접근 권한: 읽기 전용 / 읽기+쓰기 / 읽기+쓰기+Bash / 전체

### Step 3: SKILL.md 생성
`.claude/skills/custom/skill-{name}/SKILL.md` — 프론트매터(name, description, allowed-tools) + 기본 구조(실행 조건, 플로우, 출력, 주의사항)

### Step 4: CLAUDE.md CUSTOM_SECTION에 등록
1. CUSTOM_SECTION_START/END 마커 찾기 (마커 없으면 에러 후 종료)
2. "### 커스텀 스킬" 헤더 확인
3. 없으면: 헤더 + 테이블 헤더 + 행 삽입
4. 있으면: 테이블 마지막 행 뒤에 새 행 추가
5. Edit 도구로 CLAUDE.md 수정

### Step 5: 완료 리포트

필수 포함: 생성 파일 경로, CLAUDE.md 등록 확인, 다음 단계(SKILL.md 편집 → 실행 → validate)

## 주의사항
- 빌트인 스킬과 이름 충돌 방지
- CLAUDE.md CUSTOM_SECTION 마커 없으면 에러 후 종료
- 기존 커스텀 스킬 덮어쓰기 시 사용자 확인 필수
