---
name: skill-domain
description: 도메인 관리 - 조회, 전환, 커스터마이징, 워크플로우 정의. /skill-domain으로 호출합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Read, Write, Edit, Glob, AskUserQuestion
argument-hint: "[list|switch|create|add-doc|add-checklist|add-workflow|export] [options]"
complexity-hint: light
---

# skill-domain: 도메인 관리

## 실행 조건
- 사용자가 `/skill-domain` 또는 "도메인 정보 보여줘" 요청 시

## 명령어

```
/skill-domain                      # 현재 도메인 정보
/skill-domain list                 # 사용 가능한 도메인 목록
/skill-domain switch {domain}      # 도메인 전환
/skill-domain create {name} [--ref {domain}]  # 새 도메인 생성 (AI 초기 문서 포함)
/skill-domain add-doc {path}       # 참고자료 추가
/skill-domain add-checklist {path} # 체크리스트 추가
/skill-domain add-workflow {name}   # 커스텀 워크플로우 정의
/skill-domain export {name}        # 커스텀 도메인으로 내보내기
```

---

## 기본: 현재 도메인 정보

project.json에서 domain 확인 → `.claude/domains/{domain}/domain.json` 로드.
필수 포함: 설명, 적용 체크리스트 (공통/도메인 구분), 참고자료 목록, 키워드 매핑

---

## list: 사용 가능한 도메인 목록

`_registry.json` 로드 → 테이블 출력 (도메인, 아이콘, 설명, 상태) + 현재 선택 표시

---

## switch: 도메인 전환

1. 현재 상태 확인: project.json에서 domain, name 읽기
2. 대상 도메인 유효성 검증: `.claude/domains/{target}/domain.json` 존재 확인
3. 전환 영향 분석: 제거/추가되는 체크리스트, 참고자료 비교 → 사용자 확인
4. 전환 실행:
   - CLAUDE.md에서 `<!-- CUSTOM_SECTION_START/END -->` 사이 내용 추출·보존
   - project.json domain + conventions.taskPrefix 업데이트
   - CLAUDE.md 재생성 (`.claude/templates/CLAUDE.md.tmpl` 마커 치환)
   - 커스텀 섹션 복원 (상세: `.claude/templates/TEMPLATE-ENGINE.md` 참조)
5. 완료 안내: 필수 포함: 변경된 설정 (도메인, taskPrefix, 체크리스트 수), 보존된 설정, 주의사항 (기존 Task ID 유지, 새 Task부터 새 접두사)

---

## add-doc: 참고자료 추가

사용법: `/skill-domain add-doc {path|URL}`

1. 파일 확인 (로컬 파일 → cat, URL → WebFetch)
2. AskUserQuestion으로 키워드 매핑 수집 (쉼표 구분)
3. `.claude/domains/{domain}/docs/{filename}` 복사 + domain.json keywordMapping 업데이트
4. 완료 안내: 필수 포함: 파일명, 위치, 키워드

---

## add-checklist: 체크리스트 추가

사용법: `/skill-domain add-checklist {path}`

1. 파일 확인 + 형식 검증 (마크다운 테이블, 필수 컬럼: 항목/설명/심각도, 심각도: CRITICAL/MAJOR/MINOR)
2. AskUserQuestion으로 적용 시점 선택 (review / pr-review / both)
3. `.claude/domains/{domain}/checklists/{filename}` 복사 + domain.json checklists 추가
4. 완료 안내: 필수 포함: 파일명, 위치, 적용 시점

---

## add-workflow: 커스텀 워크플로우 정의

사용법: `/skill-domain add-workflow {name}`

1. AskUserQuestion으로 수집: 워크플로우 이름, 설명, 스텝 정의 (스텝명 → 스킬), 게이트 조건 (user_approval / build_success / test_pass)
2. `.claude/workflows/{name}.yaml` 생성:
   ```yaml
   name: {name}
   description: {설명}
   created: {timestamp}
   custom: true
   steps:
     - name: {스텝명}
       skill: {스킬명}
       gate: {게이트 조건}
   error_handling:
     on_failure: pause
     on_timeout: notify
   ```
3. 검증: 참조 스킬 존재, YAML 유효성, 이름 중복
4. 완료 안내: 필수 포함: 이름, 위치, 스텝 수, 사용 방법, 기존 워크플로우 목록

---

## create: 새 도메인 생성

사용법: `/skill-domain create {name} [--ref {domain}]` (--ref 미지정 시 general 기반)

1. AskUserQuestion으로 수집: 표시명, 아이콘, 설명
2. 이름 유효성 검증: 기존 도메인 충돌 확인 + 소문자 영문/하이픈만 허용
3. 디렉토리 생성: `mkdir -p .claude/domains/{name}/{docs,checklists,error-codes,templates}`
4. domain.json 생성: 참조 도메인 기반 (id, name, icon, description, status:custom, compliance:[], defaultTaskPrefix, defaultStack, keywords:{}, checklists:[common.md, security-basic.md])
5. AI 기반 초기 문서 생성:
   - 참조 도메인 docs/ 구조 분석
   - 생성: docs/overview.md, docs/common-patterns.md, docs/error-handling.md, checklists/domain-logic.md
   - 품질 기준: 참조 도메인 형식 따름, 각 50줄+, 체크리스트 CRITICAL/MAJOR/MINOR 포함
   - keywords 필드 초기화
6. `_registry.json`에 등록
7. 완료 안내: 필수 포함: ID, 표시명, 참조 도메인, 위치, 생성 파일 목록, 다음 단계 (검토, switch, add-doc, add-checklist)

---

## export: 커스텀 도메인으로 내보내기

사용법: `/skill-domain export {name}`

1. 현재 도메인 분석: domain.json, docs/, checklists/ 확인
2. 사용자 확인: 포함될 내용 + 커스터마이징 항목 표시
3. 도메인 복사: `cp -r .claude/domains/{current}/* .claude/domains/{new}/` → domain.json id/name 변경 → `_registry.json` 등록
4. 완료 안내: 필수 포함: ID, 위치, 디렉토리 구조, 다른 프로젝트 사용법, 팀 공유 방법

---

## 에러 처리

| 에러 | 원인 + 해결 |
|------|------------|
| 도메인 없음 | `/skill-domain list`로 확인 후 올바른 이름으로 재시도 |
| 프로젝트 미초기화 | project.json 없음 → `/skill-init` 먼저 실행 |
| 체크리스트 형식 오류 | 마크다운 테이블 + 항목/설명/심각도 컬럼 필수 (CRITICAL/MAJOR/MINOR) |

---

## Layered Override 확인

도메인 정보 표시 시 적용 레이어 표시:
- 체크리스트 적용 순서: _base/checklists/ (공통) → {domain}/checklists/ (도메인)
- 설정 우선순위 테이블: 설정, 값, 출처 (project.json > domain.json > _base)

## 주의사항
- 도메인 전환 시 기존 Task ID 유지, 새 Task부터 새 taskPrefix 적용
- 커스텀 체크리스트는 도메인별 관리
- export된 도메인은 _registry.json에 자동 등록
