---
name: skill-validate
description: 프레임워크 검증 - 업그레이드 후 구조 무결성 자체 검증. skill-upgrade에서 자동 호출되거나 /skill-validate로 호출합니다.
disable-model-invocation: true
allowed-tools: Bash(cat:*), Bash(ls:*), Bash(python3:*), Read, Glob, Grep
argument-hint: "[--fix]"
complexity-hint: light
---

# skill-validate: 프레임워크 검증

## 실행 조건
- `skill-upgrade` 완료 후 자동 호출
- 또는 사용자가 `/skill-validate` 직접 호출

## 옵션
```
/skill-validate          # 검증만 수행 (읽기 전용)
/skill-validate --fix    # 자동 수정 가능한 항목 수정
```

## 검증 항목

### Category 1: [REQUIRED] 구조 검증

**1. SKILL.md YAML 프론트매터**
모든 `.claude/skills/*/SKILL.md` 순회:
- `---` 시작/종료 마커, `name`/`description` 필드 존재, YAML 파싱 가능
- `complexity-hint` 필드가 존재하면 값이 `heavy|medium|light` 중 하나인지 검증 (optional 필드, 없어도 통과). 잘못된 값 → WARNING

**2. 모든 JSON 파일 유효성**
`.claude/` 하위 모든 `.json` 파싱 검증:
- schemas, domains/**/domain.json, _registry.json, migrations.json, state/*.json

**3. 도메인 레지스트리 정합성**
`_registry.json` vs 실제 디렉토리 (`_base` 제외):
- 레지스트리에 있으나 디렉토리 없음 → ERROR
- 디렉토리 있으나 레지스트리에 없음 → WARNING
- 각 도메인에 domain.json 존재 확인

**4. 템플릿 마커 완결성**
`.claude/templates/*.tmpl` 마커가 TEMPLATE-ENGINE.md에 정의돼 있는지:
- 사용됐으나 미정의 → WARNING, 정의됐으나 미사용 → INFO

### Category 2: [IMPORTANT] 참조 검증

**5. 스킬 간 교차 참조**
SKILL.md에서 참조하는 스킬/에이전트 파일 존재 확인

**6. 스키마 파일**
project.schema.json, backlog.schema.json → JSON Schema Draft-07 호환.
migrations.json → 유효 JSON + 필수 구조.

**9. 도메인 완전성**
각 도메인 (`_base` 제외):
- domain.json 존재 + 필수 필드(`id`, `name`, `icon`, `description`) → ERROR (없으면)
- docs/ 디렉토리에 최소 1개 .md → WARNING
- checklists/ 디렉토리 존재 → INFO

### Category 3: [OPTIONAL] 확장 검증

**7. 워크플로우 YAML**
필수 필드 `name`/`steps`, 각 step에 `name`/`skill`, 참조 스킬 존재

**8. 커스텀 스킬 매니페스트**
`.claude/skills/custom/skill-*/SKILL.md` 존재 + 프론트매터 유효성 + CLAUDE.md 등록 여부(WARNING) + 빌트인 이름 충돌(ERROR)

## 출력

필수 포함: 카테고리별 PASS/WARN/FAIL 수 요약 테이블, 전체 결과(PASS/FAIL + 총 통과/경고/실패 수), 경고·실패 상세, 수정 방법 안내

## --fix 모드

자동 수정 가능: 레지스트리에만 있는 도메인 → 제거, metadata.version 누락 → 기본값 1
자동 수정 불가 (수동): JSON 문법 오류, YAML 프론트매터 오류, 누락 파일

## 주의사항
- 기본 모드는 읽기 전용 (파일 수정 없음)
- `--fix`는 안전한 항목만 수정
- 검증 실패가 프레임워크 동작을 차단하지는 않음 (경고 성격)
