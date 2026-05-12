---
name: skill-docs
description: 프로젝트 참고자료 - 개발 시 자동 참조되는 도메인별 문서. 사용자가 "문서 찾아줘", "참고자료" 또는 /skill-docs를 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Read, Glob
argument-hint: "[keyword]"
complexity-hint: light
---

# skill-docs: 프로젝트 참고자료

## 개요
프로젝트 도메인별 참고자료 제공. 개발 중 관련 키워드 감지 시 자동 참조.

## 사용 방법

```
/skill-docs                    # 전체 문서 목록
/skill-docs payment            # 결제 관련 문서
/skill-docs api                # API 설계 문서
/skill-docs template api-spec  # 템플릿 출력
```

자동 참조 (disable-model-invocation: false): 개발 중 키워드 감지 → 관련 문서 자동 로드

## 문서 구조 (도메인 시스템)

문서 위치는 `project.json`의 도메인 설정에 따라 결정:

```
.claude/domains/
├── _base/
│   ├── conventions/    # 공통 개발 컨벤션
│   └── templates/      # 공통 템플릿
├── {domain}/
│   ├── docs/           # 도메인별 참고자료 + README.md (키워드 매핑)
│   ├── checklists/     # 도메인별 체크리스트
│   └── domain.json     # 도메인 설정 + 키워드 매핑
```

**로딩 우선순위**: 도메인 docs/ → _base/conventions/ → _base/templates/

## 키워드 매핑

`domain.json`의 `keywords` 필드에서 로드:
```json
{"keywords": {"payment": {"triggers": ["결제","승인","인증","카드"], "docs": ["payment-flow.md"]}}}
```

### 공통 컨벤션 키워드 (`.claude/domains/_base/conventions/`)

| 키워드 | 문서 |
|--------|------|
| API, REST, 엔드포인트, 상태코드 | api-design.md |
| 테스트, 커버리지, TDD | testing.md |
| 로그, 추적, traceId | logging.md |
| 테이블, 스키마, DB, 인덱스 | database.md |
| 에러, 예외, 재시도, 서킷브레이커 | error-handling.md |
| 보안, 인증, 암호화, XSS, CORS | security.md |
| 패키지, 구조, 레이어, 아키텍처 | project-structure.md |
| 네이밍, 변수명, 클래스명 | naming.md |
| 브랜치, 커밋, PR, Git | git-workflow.md |
| 캐시, Redis, TTL | cache.md |
| 메시지큐, Kafka, 이벤트, 비동기 | message-queue.md |
| 배포, Docker, CI/CD, K8s | deployment.md |
| 모니터링, 메트릭, 알림, 헬스체크 | monitoring.md |

## 출력

### 문서 목록 조회
필수 포함: 도메인 참고자료 테이블(문서/설명/키워드), 공통 컨벤션 테이블

### 특정 문서 조회
문서 내용 출력 + 관련 문서 목록

## 자동 참조 동작
1. 키워드 감지 → 2. domain.json/README.md 매핑 탐색 → 3. 문서 읽기 → 4. 코드 반영 → 5. 출처 표기

## 커스터마이징
새 문서 추가: `docs/` 디렉토리에 .md 추가 + `docs/README.md`에 키워드 매핑 추가

## 주의사항
- 읽기 전용 작업만 수행
- 문서 수정은 직접 파일 편집 필요
- 자동 참조는 개발 컨텍스트에서만 동작
