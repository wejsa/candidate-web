---
name: skill-onboard
description: 기존 프로젝트 온보딩 - 코드베이스 스캔 + 자동 설정 생성. 사용자가 "프로젝트 온보딩" 또는 /skill-onboard를 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(ls:*), Bash(cat:*), Bash(wc:*), Read, Write, Edit, Glob, Grep, AskUserQuestion
argument-hint: "[--scan-only]"
complexity-hint: medium
---

# skill-onboard: 기존 프로젝트 온보딩

## 실행 조건
- 사용자가 `/skill-onboard` 또는 "이 프로젝트에 적용해줘" 요청 시
- **기존 코드베이스** 대상 (새 프로젝트는 `/skill-init`)

## 옵션
```
/skill-onboard              # 전체 온보딩 (스캔 + 설정 생성)
/skill-onboard --scan-only  # 스캔만 (분석 결과 출력 후 종료)
```

## skill-init과의 차이

| 항목 | skill-init | skill-onboard |
|------|-----------|---------------|
| 대상 | 새 프로젝트 (빈 디렉토리) | 기존 코드베이스 |
| 첫 입력 | 요구사항 자유 서술 | 자동 스캔 결과 검증 |
| 도메인/스택 결정 | LLM 추론 추천 → 사용자 확인 | 파일 감지 결과 → 사용자 검증 |
| 백로그 | 요구사항에서 자동 분해 가능 (opt-in) | 빈 backlog.json |
| 기존 파일 | 없음 (있으면 init 진행 전 경고) | 백업 후 생성 |

> **이 디렉토리에 코드 파일이 없다면 `/skill-init`을 사용하세요.** skill-onboard는 기존 코드베이스 자동 스캔이 핵심이라 빈 디렉토리에서 의미 있는 결과를 만들 수 없습니다.

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. Git 저장소 확인 → 없으면 "git init 먼저 실행" 안내
2. **ai-crew-kit clone 자동 정리**: 표준 진입 플로우는 **`.claude/templates/protocols/ai-crew-kit-cleanup.md`** 의 M1 검출 + M2 가드 + 14종 삭제 표를 그대로 따른다 (SSOT — 본 SKILL.md에 복제 금지).

   본 skill-onboard에서 추가로 적용:
   - M1 통과 시점에 `KIT_SOURCE_URL` 캡처 → Step 5에서 `kitSource` 기록
   - 자동 정리 *실행* 시 `CLAUDE.md`/`README.md`/`VERSION`이 이미 삭제되므로 Step 4 백업 단계는 자연 SKIP (kit clone 케이스 예외)
   - 가드 미통과 또는 M1 불일치 시 정리 SKIP → Step 1 코드베이스 스캔으로 일반 진행 (시나리오 C)
3. 기존 AI Crew Kit 설정 (project.json) → AskUserQuestion으로 덮어쓰기 확인

## 실행 플로우

### Step 1: 코드베이스 스캔

**선행 가드**: `src/`/`app/`/`lib/` 디렉토리 또는 빌드 파일(`build.gradle*`, `pom.xml`, `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`) 중 하나도 없는 빈 디렉토리면 다음 안내 후 종료 옵션 제시:

```
⚠ 코드 파일이 감지되지 않았습니다.
  skill-onboard는 기존 코드베이스 자동 스캔이 목적입니다.
  빈 디렉토리에서 신규 프로젝트를 시작하려면 /skill-init 을 사용하세요.

  계속 skill-onboard로 진행하시겠습니까? [y/N]
```


**백엔드**: build.gradle.kts → spring-boot-kotlin / build.gradle → spring-boot-java / pom.xml → spring-boot-java / go.mod → go / pyproject.toml/requirements.txt → python (FastAPI/Django 판별) / package.json + express/fastify/nestjs → nodejs-typescript

**Python FastAPI vs Django 자동 판별**:
- `manage.py` 존재 OR `django` in dependencies → `python-django`
- `fastapi` in dependencies OR `uvicorn` in dependencies → `python-fastapi`
- 둘 다 없으면 `app/main.py` 존재 → `python-fastapi` / `config/settings/` 존재 → `python-django`
- 판별 불가 → AskUserQuestion으로 직접 선택
**프론트엔드**: next.config.* → nextjs / vite.config.* + react → react-vite / nuxt.config.* → vue-nuxt / astro.config.* → astro / vue.config.*/vue 의존성 → vue
**패키지 매니저**: bun.lockb → bun / pnpm-lock.yaml → pnpm / yarn.lock → yarn / package-lock.json → npm (복수 시 bun>pnpm>yarn>npm)
**Python 패키지**: poetry.lock → poetry / Pipfile.lock → pipenv / requirements.txt → pip
**데이터베이스**: docker-compose + 의존성 (postgres/mysql/mongodb)
**캐시/메시지큐**: docker-compose + 의존성 (redis/rabbitmq/kafka)
**인프라**: docker-compose.yml → docker-compose / k8s/ → kubernetes / Dockerfile만 → docker-compose

**빌드 명령어 감지** (techStack 기반):
- spring/kotlin → ./gradlew build/test/ktlintCheck
- java → ./gradlew build/test/checkstyleMain (Maven: mvn package/test)
- node/typescript → npm run build/test/lint (package.json scripts 확인)
- go → go build/test + golangci-lint
- python-fastapi → pytest / ruff check .
- python-django → python manage.py check / pytest / ruff check .
- nextjs → next build / vitest 또는 jest / next lint
- react-vite → vite build / vitest / eslint .
- vue-nuxt → nuxt build / vitest / eslint .
- vue → vite build / vitest / eslint .
- astro → astro build / vitest / eslint .

**도메인 추천**: `_registry.json` keywords와 매칭 (디렉토리명 3점, 파일명 2점, README/설명 1점 → 최고점 추천, 동점이면 general)

**기존 구조 분석**: 소스 파일 수, 테스트 존재 여부, 기존 문서

### Step 2: 스캔 결과 출력 + 확인
감지된 기술 스택 (항목, 결과, 신뢰도), 빌드 명령어, 도메인 추천, 프로젝트 규모 출력
AskUserQuestion: "결과 정확" / "기술 스택 수정" / "도메인 변경"
`--scan-only` 모드: 여기서 종료

### Step 3: 추가 정보 수집
AskUserQuestion: 프로젝트 이름 (디렉토리명 기본값), 설명, 에이전트 구성 (skill-init Step 5 동일 — 스택 기반 필수 자동 결정 + 선택 추가), Task 접두사

### Step 4: 기존 파일 백업
README.md → README.md.bak / CLAUDE.md → CLAUDE.md.bak (존재 시)

> **kit clone 케이스 예외**: 사전 조건 2번에서 자동 정리로 README.md/CLAUDE.md/VERSION이 이미 삭제되었으므로 본 단계에서 백업 대상 없음. 자연스럽게 스킵됨.

### Step 5: 설정 파일 생성
skill-init Step 10 동일: project.json (buildCommands 포함), backlog.json (빈 값으로 초기화 — 자동 분해는 init 전용), CLAUDE.md, README.md, VERSION (기존 있으면 유지)
커스텀 스킬: `.claude/skills/custom/` 존재 시 스캔 → CLAUDE.md CUSTOM_SECTION에 삽입

### Step 6: Git 설정
- develop 브랜치 생성 (없는 경우)
- .gitignore에 `.claude/temp/` 추가 (없는 경우)

### Step 7: 완료 리포트
필수 포함: 프로젝트 정보, 생성된 파일, 백업된 파일, 다음 단계 (/skill-feature, /skill-backlog, /skill-plan)

## 주의사항
- 기존 코드/파일은 절대 수정하지 않음 (AI Crew Kit 설정만 추가)
- README.md.bak 백업은 온보딩 시에만 생성
- 스캔 결과 100% 정확하지 않을 수 있으므로 사용자 확인 필수
- 감지 실패 시 사용자에게 직접 입력 요청
- ports는 docker-compose 포트 매핑 있으면 포함, 없으면 생략
