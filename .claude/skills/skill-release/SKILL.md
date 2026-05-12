---
name: skill-release
description: 릴리스 - 빌드 검증 + API spec 스냅샷 + 버전 범프 + CHANGELOG + main 머지 + 태그 생성. /skill-release로 호출합니다.
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(gh:*), Bash(cat:*), Bash(./gradlew:*), Bash(npm:*), Bash(yarn:*), Bash(go:*), Bash(swag:*), Read, Write, Edit, Glob, AskUserQuestion, Skill
argument-hint: "{버전타입: patch|minor|major}"
complexity-hint: light
---

# skill-release: 릴리스 자동화

## 실행 조건
- 사용자가 `/skill-release {버전타입}` 요청 시 (develop 브랜치에서만)

## 버전 타입
| 타입 | 설명 | 예시 |
|------|------|------|
| patch | 버그 수정 | 1.1.0 → 1.1.1 |
| minor | 기능 추가 | 1.1.0 → 1.2.0 |
| major | Breaking 변경 | 1.1.0 → 2.0.0 |

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재
2. backlog.json 존재 + 유효 JSON
3. Worktree 환경 차단 (`git-dir != git-common-dir` → STOP, 메인 레포에서 실행 안내)
4. develop 브랜치 확인
5. Clean 상태 (uncommitted changes 없음)
6. `git fetch origin`
7. Health Gate (선택): project.json에 healthCheck 설정이 있으면
   /skill-health-check --quick 실행. CRITICAL 0건이어야 진행.
   healthCheck 설정이 없거나 실패 시에도 AskUserQuestion으로 계속 여부 확인.
   (릴리스를 차단하지 않음 — 사용자 판단에 맡김)

## 실행 플로우

### 1. 현재 버전 읽기
`cat VERSION`

### 2. 새 버전 계산
MAJOR.MINOR.PATCH 파싱 → 타입에 따라 범프

### 3. 빌드 & 테스트 검증
빌드 명령어: `buildCommands` 우선 → `techStack.backend` 폴백
- spring/kotlin/java → `./gradlew build` + `./gradlew test`
- node/typescript → `npm run build` + `npm test`
- go → `go build ./...` + `go test ./...`

project.json 미존재 시 스킵. 실패 시 즉시 중단 (파일 변경 전이므로 롤백 불필요).

### 4. 변경사항 수집
- 마지막 태그 이후 커밋 자동 수집 (태그 없으면 최근 50개)
- conventional commit prefix 분류: feat→Added, fix→Fixed, refactor/perf→Changed, docs/chore/test→제외
- AskUserQuestion으로 초안 확인 ("그대로 사용" 또는 수정)

### 5-7. 파일 업데이트
- VERSION 파일: `echo "$NEW_VERSION" > VERSION`
- CHANGELOG.md: `## [X.Y.Z] - YYYY-MM-DD` 섹션 삽입 ([Unreleased] 아래)
- README.md: project.json name 기반 동적 패턴으로 제목 버전 교체

### 8. API spec 스냅샷

| 스택 | 감지 방법 | 생성 명령 |
|------|----------|----------|
| spring-boot | build.gradle에 openapi-gradle-plugin | `./gradlew generateOpenApiDocs` |
| nodejs | package.json에 generate:api-docs | `npm run generate:api-docs` |
| go | swag 명령 존재 | `swag init -o docs/api-specs` |

**플러그인 미감지 시 자동 설치**:
- Spring Boot: springdoc-openapi 플러그인 + 의존성 + openApi 설정 블록 추가
- Node.js: swagger-jsdoc 패키지 설치 + scripts 추가 + generate 스크립트 생성
- Go: `go install github.com/swaggo/swag/cmd/swag@latest`

생성 성공: info.version을 NEW_VERSION으로 업데이트
실패: AskUserQuestion "계속 진행?" (릴리스 차단 아님)

### 9. develop 커밋
```bash
git add VERSION CHANGELOG.md README.md
# API spec + 빌드 파일 변경 포함
git commit -m "chore: release v$NEW_VERSION

- VERSION: $CURRENT_VERSION → $NEW_VERSION
- CHANGELOG.md 업데이트
- README.md 버전 업데이트

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### 10. develop → main 머지
```bash
git checkout main && git pull origin main
git merge develop -m "Merge branch 'develop' for release v$NEW_VERSION"
```

### 11. 태그 생성
`git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"`

### 12. 원격 푸시
`git push origin develop && git push origin main && git push origin "v$NEW_VERSION"` → `git checkout develop`

## 출력 포맷
필수 포함: 이전/새 버전, 태그, 브랜치 머지 상태, 빌드/테스트 결과, API spec 결과, 변경사항 요약 (Added/Changed/Fixed), GitHub 확인 링크

## 롤백

| 실패 지점 | 롤백 |
|----------|------|
| Step 3 빌드/테스트 | 불필요 (파일 변경 전) |
| Step 8 API spec | 사용자 확인 후 스킵 가능 |
| Step 9 커밋 | `git reset --hard HEAD~1` |
| Step 10+ | 태그 삭제 + main/develop reset + force push |

## 주의사항
- develop 브랜치에서만 실행, main 직접 실행 금지
- Clean 상태 필수, 충돌 발생 시 수동 해결 후 재시도
