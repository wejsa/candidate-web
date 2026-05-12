---
name: skill-health-check
description: 코드베이스 건강 검진 - 문서↔코드 동기화, 상태 정합성, 기본 보안, 에이전트 설정, 도메인 컴플라이언스 검증. 사용자가 "헬스체크 해줘", "정리해줘" 또는 /skill-health-check를 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(grep:*), Bash(find:*), Bash(python3:*), Read, Glob, Grep, Write
argument-hint: "[--quick|--scope <category>|--fix]"
complexity-hint: heavy
---

# skill-health-check: 코드베이스 건강 검진

## 실행 조건
- /skill-health-check 또는 "건강 검진해줘", "전체 검진해줘", "헬스체크 돌려줘"
- "정리해줘", "cleanup" → --fix 모드로 자동 전환

## 기존 도구와의 관계
- /skill-status --health: 운영 준비 경량 점검 (JSON 유효성, orphan intent). 매일 사용.
- /skill-health-check (이 스킬): 코드↔문서 동기화, 상태 정합성 심층 검진. 주 1회 또는 릴리스 전.
- /skill-validate: 프레임워크 구조 무결성. 업그레이드 후 자동 호출.
- 이 스킬은 skill-validate와 중복 검사하지 않는다. 각자 고유 영역만 담당.

## 명령어 옵션
| 모드 | 명령어 | 설명 |
|------|--------|------|
| 전체 검사 | /skill-health-check | 전체 실행 |
| 빠른 검사 | /skill-health-check --quick | CRITICAL 항목만 |
| 영역 지정 | /skill-health-check --scope doc-sync | 특정 카테고리만 |
| 자동 수정 | /skill-health-check --fix | autoFix 가능 항목 즉시 반영 |

## 실행 절차

### Phase A: 설정 로딩
1. .claude/state/project.json에서 현재 도메인과 techStack 확인
   - project.json이 없으면 도메인 "general", techStack 미설정으로 간주
2. .claude/domains/_base/health/_category.json 로딩
3. .claude/domains/{domain}/health/_category.json 로딩 (있으면 병합 — 두 형태 모두 지원)
   - **형태 A (legacy)**: `additionalCategories` + `weightOverrides` 키 사용 (예: fintech)
     - additionalCategories → _base 카테고리 리스트에 추가
     - weightOverrides → 기존 카테고리 가중치 조정
   - **형태 B (dictionary)**: `categories: { id: {weight?, failCap?, description?} }` 키 사용 (예: ecommerce/healthcare/saas)
     - 기존 _base 카테고리는 dictionary 항목으로 override (weight/failCap/description)
     - dictionary에 새로운 id가 있고 _base에 없으면 추가 (additionalCategories와 동등)
     - _base에만 있고 dictionary에 없는 카테고리는 _base 값 유지 (예: hook-safety 10은 도메인 override 부재 시 그대로 유지)
   - 두 형태는 상호 배타적 — 한 파일에 섞지 말 것
   - 최종 가중치 합이 100이 아니면 자동 정규화 (각 weight × (100 / Σweight))
4. project.json의 healthCheck.exclude에 있는 항목 ID 제외
5. --scope 옵션이 있으면 해당 카테고리만 필터
6. --quick 옵션이 있으면 severity: CRITICAL만 필터

### Phase B: 검사 실행
아래 "검사 항목" 섹션의 각 항목에 대해:
1. 사전 조건 확인 → 미충족 시 SKIP
2. 검사 실행
3. 결과: PASS | FAIL | SKIP | ERROR
4. FAIL인 항목에 대해:
   - CRITICAL FAIL → backlog.json에 bugfix Task 자동 등록 (priority: critical)
   - MAJOR FAIL → backlog.json에 improvement Task 자동 등록 (priority: major)
   - MINOR FAIL → 리포트에만 표시 (backlog 미등록)
   - backlog.json이 없으면 backlog 등록을 스킵한다
   - --fix 모드 진입 시 먼저 전체 검사를 실행하고, autoFix 대상 항목 목록을 요약 표시한 후 AskUserQuestion으로 일괄 승인을 받는다. 사용자가 거절하면 --fix 없이 리포트만 출력한다.
   - 승인 후 개별 confirm:true 항목은 실행 시 추가 확인한다.
   - autoFix 실행이 실패하거나 사용자가 거절하면 원래 상태를 유지하고 FAIL로 기록한다. fixesApplied에는 성공한 항목만 포함한다.

### Phase C: 점수 계산
1. 카테고리별 점수 = (PASS 수 / (PASS + FAIL + ERROR 수)) × 100
   - SKIP은 분모에서 제외
   - 카테고리의 모든 항목이 SKIP이면 (PASS+FAIL+ERROR=0) 해당 카테고리는 가중 평균에서 제외한다 (남은 카테고리로 가중치 재분배).
   - 해당 카테고리에 CRITICAL FAIL이 하나라도 있으면 점수 상한 = failCap
2. 전체 점수 = Σ(카테고리 점수 × 가중치) / Σ(가중치)
3. 등급 판정: _category.json의 gradeThresholds 참조

### Phase D: 리포트 생성
1. 콘솔 요약 출력 (아래 형식 참조)
2. .claude/state/health-history.json에 결과 누적
   - 파일이 없으면 초기 구조 자동 생성: {"version": "1.0.0", "history": []}
   - .claude/state/ 디렉토리가 없으면 mkdir -p로 생성
   - 이전 기록 대비 변화량 표시
   - 3회 연속 FAIL인 항목은 severity 자동 상향 제안
3. health-history.json 기록은 항상 마지막에 수행 (중간 실패해도 기존 이력 보존)
4. 추세 경보 (history에 3회 이상 기록이 있을 때):
   - 동일 항목 3회 연속 FAIL → "⚠️ {항목ID}가 3회 연속 실패 중. severity 상향을 고려하세요."
   - 전체 점수 3회 연속 하락 → "⚠️ Health score 지속 하락: {N1}점 → {N2}점 → {N3}점"
   - 특정 카테고리 failCap 이하 3회 연속 → "⚠️ {카테고리} 집중 점검 필요"
   - history가 3회 미만이면 추세 분석을 스킵한다.
   - streak 판정 규칙: SKIP은 streak 미중단 (체크된 실행만 카운트), ERROR는 FAIL 취급, mode가 fix/quick-fix인 실행은 제외, PASS 시 streak 리셋.
5. history 배열이 50건 초과 시 oldest부터 삭제한다.

### 콘솔 출력 형식

```
╔════════════════════════════════════════╗
║        Health Check Report             ║
║        {timestamp}                     ║
╠════════════════════════════════════════╣
║  Overall Score: {score}/100  {grade}   ║
║                                        ║
║  {category1}  {bar}  {percent}%        ║
║  {category2}  {bar}  {percent}%        ║
║  ...                                   ║
╠════════════════════════════════════════╣
║  CRITICAL: {n}건  MAJOR: {n}건         ║
╠════════════════════════════════════════╣
║  {항목ID} {항목명}                      ║
║     {상세 설명}                        ║
║  ...                                   ║
╚════════════════════════════════════════╝

이전 기록 대비:
  Score: {이전}점 → {현재}점 (+{차이})
  해결: {해결된 항목 목록}
  신규: {새로 발견된 항목 목록}
```

---

## 검사 항목

### 카테고리: doc-sync (문서 ↔ 코드 동기화)

#### DS-01. 빌드 명령어 실행 (CRITICAL)
- 사전 조건: CLAUDE.md 존재
- 검사: CLAUDE.md의 Build/빌드 섹션에서 코드 블록 추출 → 실행 → exit code 확인
- timeout: 120초. 초과 시 ERROR.
- FAIL 시: backlog 자동 등록 (CRITICAL bugfix)
- autoFix: 불가

#### DS-02. 테스트 명령어 실행 (CRITICAL)
- 사전 조건: CLAUDE.md 존재
- 검사: CLAUDE.md의 Test/테스트 섹션에서 코드 블록 추출 → 실행 → exit code 확인
- timeout: 180초
- FAIL 시: backlog 자동 등록
- autoFix: 불가

#### DS-03. 기술 스택 정합성 (MAJOR)
- 사전 조건: .claude/state/project.json 존재
- 검사: project.json의 techStack vs 실제 의존성 파일 대조
  - 탐지 대상: build.gradle.kts, build.gradle, pom.xml, package.json, requirements.txt, go.mod
  - techStack에 "spring-boot-kotlin"이지만 build.gradle이 없으면 FAIL
  - 반대로 package.json이 있는데 techStack이 "nodejs"가 아니면 FAIL
- autoFix: project.json 업데이트 가능 (confirm: true)

#### DS-04. 환경변수 동기화 (MAJOR)
- 사전 조건: CLAUDE.md 존재
- 검사: 코드 내 환경변수 참조 패턴 vs CLAUDE.md 환경변수 섹션
  - 패턴: @Value("${...}"), process.env.XXX, os.environ["XXX"], os.Getenv("XXX")
  - 코드에만 있고 문서에 없는 환경변수 → FAIL
  - spring.*, server.* 프레임워크 기본값은 무시
  - techStack에 따라 적절한 패턴 사용 (Claude가 맥락 판단)
- autoFix: 불가 (수동 문서 업데이트 필요)

#### DS-05. 패키지 구조 동기화 (MAJOR)
- 사전 조건: CLAUDE.md 존재 + src/ 디렉토리 존재
- 검사: CLAUDE.md 패키지 구조 섹션 vs 실제 파일시스템
  - phantom path (문서에만 존재) → MAJOR
  - undocumented path (코드에만 존재, 주요 디렉토리) → MINOR
- autoFix: CLAUDE.md 구조 섹션 재생성 가능 (confirm: true)

#### DS-06. CLAUDE.md 신선도 (MINOR)
- 사전 조건: CLAUDE.md 존재
- 검사: CLAUDE.md 마지막 수정일 이후 src/ 변경 커밋 수 카운트
  - 30건 이상이면 "문서가 오래됨" 판정 → FAIL
- autoFix: 불가 (CLAUDE.md 재생성 안내만)

#### DS-07. 요구사항 문서 존재 (MINOR)
- 사전 조건: .claude/state/completed.json 존재
- 검사: 완료된 feature Task에 대응하는 docs/requirements/ 파일 존재 확인
  - 파일명에 Task ID가 포함되어야 함
- autoFix: 불가

### 카테고리: state-integrity (상태 파일 정합성)

#### SI-01. 고아 브랜치 탐지 (MAJOR)
- 사전 조건: .claude/state/backlog.json 존재
- 검사: feature/* 또는 {taskPrefix}-* 브랜치 중 backlog.json에 없는 것
- autoFix: 사용자 확인 후 고아 브랜치 삭제 (confirm: true)

#### SI-02. 고아 Task 탐지 (MAJOR)
- 사전 조건: .claude/state/backlog.json 존재
- 검사: in_progress 상태 Task 중 대응 브랜치가 없는 것
  - 주의: skill-status --health의 orphan intent 점검과는 다른 대상
- autoFix: status를 'ready'로 리셋 (confirm: true)

#### SI-03. 잠금 만료 탐지 (MINOR)
- 사전 조건: .claude/state/backlog.json 존재
- 검사: lockedBy 필드가 있는 Task 중 lockedAt이 1시간 이상 경과한 것
- autoFix: 자동 잠금 해제 (confirm: false — TTL 초과는 명백한 비정상)

#### SI-04. backlog 내부 논리 검증 (MAJOR)
- 사전 조건: .claude/state/backlog.json 존재
- 검사:
  - 중복 Task ID 존재 여부
  - 의존성(dependsOn) 참조가 실제 존재하는 Task ID인지
  - 순환 의존성 여부
  - task.status 값이 허용된 enum인지 (todo, in_progress, done, blocked, archived)
  - step.status 값이 허용된 enum인지 (pending, in_progress, pr_created, merged, done, skipped)
  - task.type 값이 허용된 enum인지 (feature, bug, chore, spike) — 미설정 시 유효
  - **archived Task 제외**: status="archived"인 Task는 건강 검진 대상에서 제외 (카운트만 표시)
- FAIL 시: backlog 자동 등록
- autoFix: 불가 (수동 수정 안내)

#### SI-05. 에이전트 파일 정합성 (CRITICAL)
- 사전 조건: .claude/state/project.json 존재
- 검사: project.json의 agents.enabled 목록 vs .claude/agents/agent-*.md 파일 존재 대조
  - 주의: 필드명은 agents.enabled (agents.active 아님)
  - enabled에 있으나 파일 없음 → CRITICAL
  - 파일 있으나 enabled에 없음 → MINOR (정보 제공)
- FAIL 시: backlog 자동 등록
- autoFix: 불가

### 카테고리: security (기본 보안 — 전체 도메인 공통)

아래 항목들은 모든 도메인에서 실행된다.
검사 대상 파일 패턴은 techStack에 따라 Claude가 맥락적으로 결정한다:
- spring-boot-kotlin/java: src/**/*.{kt,java}
- nodejs-typescript: src/**/*.{ts,js}
- python-fastapi/python-django: src/**/*.py 또는 app/**/*.py 등 (프로젝트 구조 맥락 판단)
- go: **/*.go
- 해당 패턴에 매칭되는 파일이 0건이면 SKIP

#### 외부 패턴 로드 절차 (SEC-01 / SEC-05 / SEC-07 공유)

SEC-01 / SEC-05 / SEC-07은 `secrets-patterns.json` 외부 파일을 동적 로드한다.

| 경로 | 섹션 | 매핑 | 부재 시 |
|------|------|------|---------|
| `.claude/domains/_base/health/secrets-patterns.json` | `common.runtime` | SEC-01 | SEC-01 SKIP + WARN ("외부 패턴 파일 부재") |
| `.claude/domains/_base/health/secrets-patterns.json` | `common.hardcoded` | SEC-05 | SEC-05 SKIP + WARN |
| `.claude/domains/{domain}/health/secrets-patterns.json` | `domain.patterns` | SEC-07 | SEC-07 SKIP (정상 — 도메인 콘텐츠 부재 가능) |

오류 처리:
- JSON 파싱 실패 → 해당 SEC-* ERROR 보고 + 카테고리 부분 SKIP. 다른 SEC-* 정상 실행
- 개별 패턴의 정규식 컴파일 실패 → 해당 패턴만 SKIP + WARN. 같은 파일 다른 패턴 정상 실행
- 도메인 patterns 파일에 `common` 섹션이 있으면 무시 + WARN ("`common`은 `_base`만 보유 — `_base/health/README.md` 참조")

#### excludeContexts 처리 SSOT (SEC-01 / SEC-05 / SEC-07 공통)

각 패턴 entry의 `excludeContexts` 배열은 다음 정규식으로 처리한다 (`_base/health/README.md` enum 정의의 SSOT 구현).

| enum | 정규식 | 매칭 라인 검사 제외 사유 |
|------|--------|--------------------------|
| `env_var_reference` | `process\.env\.\w+`, `os\.environ\[`, `os\.getenv\(`, `System\.getenv\(`, `os\.Getenv\(`, `os\.LookupEnv\(` | 환경변수 참조는 실제 시크릿이 아님. JS/Python(dict, getenv)/Java/Go(Getenv, LookupEnv) 커버 |
| `type_declaration` | `\b(?:class\|interface\|type)\s+\w+` | 타입/클래스 선언부 (예: `class Password { }`) |
| `comment` | `^\s*(?://\|#\|\*\|/\*)` | 주석 라인 |

처리 순서:
1. `excludeFiles` 글롭 매칭 → 해당 파일 전체 검사 제외
2. 파일 내 라인별 패턴 매칭
3. 매칭 라인이 `excludeContexts`에 명시된 enum 중 하나의 정규식과 매칭되면 검사 제외
4. 남은 매칭만 FAIL로 보고

**`type_declaration` 처리 한계 (single-line 정의)**: 위 3단계는 라인 전체를 제외한다. 따라서 `class PasswordValidator { val secret = "abc1234567890123" }` 같이 한 줄에 타입 선언과 시크릿 리터럴이 함께 있으면 SEC-S02 매칭이 누락된다 (false negative). 워크어라운드: 시크릿 리터럴은 별도 라인 또는 companion `const`/`object`로 분리. 본 한계는 v2.1+에서 토큰-단위 처리로 정밀화 검토.

#### 출처 표기 형식 (SEC-01 / SEC-05 / SEC-07)

리포트 출력 시 외부 패턴 ID를 함께 표기한다:
```
SEC-05: 하드코딩 시크릿 (src/main/.../Config.kt:42) — 외부 패턴 SEC-S01 (API 키 하드코딩)
```

#### confidence 안내 (SEC-01 medium 패턴 한정)

`common.runtime` SEC-S06~S17은 v1.x 회귀 보존을 위해 `confidence: medium`(예외)이다. FAIL 메시지에 다음 안내를 첨부한다.
> ℹ️ medium confidence — 정보성 로그 메시지(예: `logger.info("Password validation failed")`) false positive 가능. 변수 보간이 아닌 단순 키워드 등장이면 무시 가능. 정밀화는 v2.1+ 검토 (`_base/health/README.md` confidence 가이드 참조).

신규 추가 패턴(`common.hardcoded` SEC-S01~S05, `domain.patterns`)은 모두 `high`이며 별도 안내 없이 FAIL 처리한다.

#### SEC-01. 민감정보 로깅 금지 (CRITICAL)
- 사전 조건: 외부 패턴 로드 절차에 따라 `_base/health/secrets-patterns.json` `common.runtime` 로드 성공 (부재/파싱 실패 시 SKIP + WARN). techStack에 따른 코드 파일 매칭 결과 0건이면 SKIP.
- 검사: `common.runtime` 패턴(SEC-S06~S17, 12개, medium)을 코드 파일에 매칭. excludeFiles + excludeContexts SSOT 적용 후 남은 매칭이 1건 이상이면 FAIL.
  - v1.x 인라인 12 패턴(log.*password / log.*cardNumber / log.*creditCard / log.*cvv / log.*ssn / log.*주민등록 / logger.*secret / println.*password / log.*apiKey / log.*token / log.*bearer / log.*authorization)을 외부화 — 키워드 1:1 동일, 정규식은 단어 경계 + log/logger/println 변형 흡수로 정밀화
  - FAIL 시 매칭 위치 + 외부 패턴 ID(SEC-S{nn}) 리포트에 포함 + medium confidence 안내 첨부
- 참조: `_base/checklists/security-basic.md` "로깅 금지", `_base/health/README.md` confidence 등급 가이드
- FAIL 시: backlog 자동 등록
- autoFix: 불가 (보안 관련은 수동 수정 필수, D5)

#### SEC-02. SQL Injection 위험 (CRITICAL)
- 검사: SQL 쿼리에서 안전하지 않은 파라미터 바인딩 탐지
  - MyBatis XML: src/**/*.xml에서 ${...} 중 #{...}가 아닌 것 (tableName, columnName, orderBy 제외)
  - JPA @Query: SpEL 파라미터 직접 삽입 (문자열 결합으로 쿼리 생성)
  - JDBC: jdbcTemplate/createNativeQuery에서 string concatenation 사용
  - techStack 맥락에 따라 해당 패턴 적용 (대상 파일 0건이면 SKIP)
  - 매칭 위치 리포트 포함
- 참조: _base/checklists/security-basic.md "SQL Injection"
- FAIL 시: backlog 자동 등록

#### SEC-03. CORS 설정 (MAJOR)
- 검사: CORS에서 allowedOrigins("*") 사용 금지
  - 패턴: allowedOrigins("*"), Access-Control-Allow-Origin: *
  - 매칭 위치 리포트 포함
- 참조: _base/checklists/security-basic.md "입력 검증" + 해당 도메인 security 체크리스트

#### SEC-04. API 인증 (MAJOR)
- 검사: Controller에 인증 관련 어노테이션 존재 확인
  - Kotlin/Java: @PreAuthorize, @Secured, @RolesAllowed, @AuthenticationPrincipal
  - TypeScript: @UseGuards, @Auth, authMiddleware
  - Go: middleware.Auth, authRequired
  - 예외: *Health*Controller, *Public*Controller (헬스체크, 공개 API)
  - 대상 파일 각각에 존재해야 PASS (each scope)
- 참조: _base/checklists/security-basic.md "인증 필수"

#### SEC-05. 하드코딩 시크릿 (CRITICAL)
- 사전 조건: 외부 패턴 로드 절차에 따라 `_base/health/secrets-patterns.json` `common.hardcoded` 로드 성공 (부재/파싱 실패 시 SKIP + WARN). techStack에 따른 코드 파일 매칭 결과 0건이면 SKIP.
- 검사: `common.hardcoded` 패턴(SEC-S01~S05, 모두 high confidence)을 코드 파일에 매칭. excludeFiles + excludeContexts SSOT 적용 후 남은 매칭이 1건 이상이면 FAIL.
  - SEC-S01: API 키 하드코딩 — `api[_-]?key`/`apikey` + 16자 이상 리터럴
  - SEC-S02: 시크릿 / 비공개 키 — `secret`/`private[_-]?key` + 16자 이상 리터럴
  - SEC-S03: AWS Access Key — `AKIA|AGPA|AROA|AIDA|ANPA` prefix + 16자 (ASIA STS 임시 토큰은 의도적 제외)
  - SEC-S04: GitHub Token — `ghp|gho|ghu|ghs|ghr` prefix + 36자 (PAT/OAuth/User App/Server App/Refresh)
  - SEC-S05: Slack Bot/User Token — `xox[bp]-...` prefix
- FAIL 시 매칭 위치 + 외부 패턴 ID 리포트에 포함. 사용자에게 환경변수 또는 시크릿 매니저 사용 안내.
- 참조: `_base/checklists/security-basic.md` "시크릿 관리", `_base/health/README.md` 새 패턴 추가 절차
- FAIL 시: backlog 자동 등록 (CRITICAL bugfix)
- autoFix: 불가 (D5)

#### SEC-06. 환경변수 파일 노출 (CRITICAL)
- 사전 조건: 프로젝트 루트에 dotenv 파일이 존재 (`.env`, `.env.local`, `.env.production`, `.env.development` 등 — 단 `.env.example`/`.env.template`/`.env.sample`은 placeholder 가정으로 제외).
  - dotenv 파일 부재 시 SKIP (정상 — dotenv 미사용 프로젝트)
- 검사: 다음 두 게이트 중 하나라도 위반하면 FAIL.
  1. **gitignore 등록 게이트**: `.gitignore`에 `.env*` 또는 `.env` 또는 정확한 파일명 매칭 라인 존재
     - `.gitignore` 부재 → FAIL ("프로젝트에 `.gitignore` 부재")
     - `.gitignore` 존재하나 dotenv 패턴 미등록 → FAIL ("`.env` 파일이 `.gitignore`에 미등록 — git commit 시 시크릿 노출 위험")
  2. **평문 시크릿 게이트**: 검사 대상 dotenv 파일 내용에 `common.hardcoded` 정밀 패턴(SEC-S03/S04/S05 — AWS/GitHub/Slack 명시 prefix)이 매칭되지 않아야 함
     - placeholder 매칭(`<...>`, `xxx`, `your-...`, `replace-me`, `example-` 등 휴리스틱)은 통과 처리
     - 실제 prefix 매칭(예: `AKIA[A-Z0-9]{16}`)은 FAIL ("`.env`에 실제 시크릿 형식 노출 — 즉시 회수 + git history 점검 필요")
- FAIL 시 backlog 자동 등록 + 사용자에게 다음 안내:
  - `.gitignore`에 `.env*` 추가
  - 이미 commit된 경우 `git rm --cached <파일>` 후 재커밋
  - 노출된 시크릿은 외부 콘솔(AWS/GitHub/Slack)에서 즉시 회수
- autoFix: 불가 (수동 수정 + 자격 회수 필수)

#### SEC-07. 도메인별 민감 데이터 (CRITICAL)
- 사전 조건:
  - `project.json`의 `domain` ≠ `general` (general 도메인은 도메인 특화 패턴 없음 → SKIP)
  - `.claude/domains/{domain}/health/secrets-patterns.json` 파일 존재 + `domain.patterns` 섹션 존재
  - 위 모두 미충족 시 SKIP (정상 — 도메인 콘텐츠 미작성)
- 검사: `domain.patterns` 패턴(high confidence만)을 코드 파일에 매칭. excludeFiles + excludeContexts SSOT 적용. 남은 매칭이 1건 이상이면 FAIL.
- 체크섬 검증 (false positive 차단):
  - **PAN(카드번호 16자리)**: 정규식 매칭 후 Luhn 알고리즘 검증
    - 우→좌 짝수 위치(1-indexed)만 ×2 → 결과가 10 이상이면 자릿수 합으로 변환 → 전체 합 mod 10 == 0이면 통과
    - Luhn 실패 시 매칭 폐기 (false positive로 간주)
  - **한국 주민등록번호 (13자리)**: 가중치 [2,3,4,5,6,7,8,9,2,3,4,5] × 앞 12자리 → 합 mod 11 → 11 - 결과 → mod 10이 마지막 자리와 일치
  - **한국 사업자번호 (10자리)**: 가중치 [1,3,7,1,3,7,1,3,5] × 앞 9자리 → 합산 → (9번째 자리 × 5) ÷ 10 몫을 합에 추가 → (10 - 합 mod 10) mod 10이 10번째 자리(체크섬)와 일치하면 통과. 9번째 자리는 앞 9자리의 마지막(0-indexed `n[8]`, 1-indexed 9th — 기존 "8번째 자리" 표기는 1-indexed/0-indexed 모호로 정정. tests/secrets/conftest.py `biz_ok` 표준 구현). 국세청 사업자등록번호 체계.
  - 도메인 패턴이 체크섬 검증을 요구하는 경우 도메인 `secrets-patterns.json` description에 명시 + 본 SKILL.md 절차에 위임 (Step 3 도메인 추가 시 체크섬 알고리즘 사양 첨부)
- FAIL 시 매칭 위치 + 외부 패턴 ID + 도메인 표기 (예: `SEC-07: PAN 노출 (src/.../Order.kt:88) — 외부 패턴 fintech/SEC-S{nn} (PAN Luhn 통과)`)
- 참조: `domains/{domain}/checklists/`의 해당 도메인 컴플라이언스 항목, `_base/health/README.md` 새 도메인 패턴 추가 절차
- FAIL 시: backlog 자동 등록 (CRITICAL bugfix)
- autoFix: 불가 (D5)

> **다층 방어 메모 (D6)**: SEC-07은 헬스체크 시점의 정규식 자동 검사이며, Phase 4 `rules/{domain}/{language}/`는 PR 리뷰 시점의 LLM 의미 판단이다. 동일 라인이 양쪽에서 보고되어도 검사 시점/방식이 다른 다층 방어로 정상이다 — 출처 표기로 분별 가능.

### 카테고리: agent-config (에이전트 설정 유효성)

#### AC-01. 활성 도메인 유효성 (CRITICAL)
- 사전 조건: .claude/state/project.json 존재
- 검사: project.json의 domain 값이 _registry.json에 등록되어 있는지
  - 주의: 이 항목은 skill-validate Cat 1-3에서도 유사하게 점검됨.
    skill-validate는 "구조적 존재"를, 이 항목은 "런타임 설정 유효성"을 확인.
    skill-validate를 최근 실행했다면 SKIP 가능.
- FAIL 시: backlog 자동 등록
- autoFix: 불가

#### AC-02. 스킬 SKILL.md 본문 완전성 (MINOR)
- 사전 조건: 없음 (항상 실행)
- 검사: .claude/skills/*/SKILL.md에 필수 섹션 존재 확인
  - 필수: "실행 조건" 또는 "트리거", "실행 플로우" 또는 "워크플로우" 또는 "절차"
  - 주의: skill-validate는 YAML 프론트매터만 검증. 이 항목은 본문 구조를 검증.
- autoFix: 불가

### 카테고리: hook-safety (훅 안전성 — Hook Integrity Audit)

본 카테고리는 `.claude/settings.json`의 `hooks` 필드와 `.claude/hooks/**/*.sh` 스크립트에 대해
위험 패턴 / 외부 스크립트 참조 / 스키마 유효성 / 비블로킹 규칙을 정적 검사한다.
Claude Code 네이티브 훅은 clone 즉시 모든 contributor 세션에서 자동 실행되므로 본 카테고리는
**공급망 공격 1차 방어선**이다. autoFix는 전 항목 불가 (보안 관련은 수동 수정 필수).

사전 조건 규칙:
- `.claude/settings.json` 및 `.claude/hooks/` 중 어느 것도 없으면 카테고리 전체 SKIP.
- `.claude/hooks/tests/` 디렉토리는 테스트 fixture 포함으로 모든 검사에서 제외한다.

#### HI-01. 차단 패턴 탐지 (CRITICAL)
- 사전 조건: `.claude/settings.json`의 hooks 필드 존재 또는 `.claude/hooks/*.sh` 1개 이상 존재
- 검사 대상:
  - `.claude/settings.json`의 모든 `hooks[].hooks[].command` 문자열
  - `.claude/hooks/**/*.sh` (주석 라인 `#` 제외, `tests/` 제외)
- 차단 패턴 정규식 (하나라도 매칭되면 FAIL, 매칭 위치 리포트 포함):
  - `\brm\s+-[rf]+` — 재귀 강제 삭제
  - `\bsudo\b` — 권한 상승
  - `\bcurl\b`, `\bwget\b` — 외부 요청 (설정/스크립트 내)
  - `git\s+reset\s+--hard` — 파괴적 git reset
  - `git\s+push\s+(--force(?!-with-lease)\b|-f\b)` — 파괴적 git push (`--force-with-lease`는 안전하므로 제외)
  - `\|\s*(curl|wget|nc|bash|sh)\b` — 파이프 실행
- FAIL 시: backlog 자동 등록 (CRITICAL bugfix)
- autoFix: 불가 (수동 수정 필수)
- 참조: docs/v2/phase-1-plan.md §보안 리뷰 필수 변경점

#### HI-02. 외부 스크립트 참조 탐지 (CRITICAL)
- 사전 조건: HI-01과 동일
- 검사 대상: HI-01과 동일
- 위반 조건 — **실행 키워드 직후 경로만 검사**하여 환경변수 할당 등 오탐 방지:
  - 실행 키워드: `source`, `bash`, `sh`, `exec`, `eval`, `.`(dot-source), 셔뱅(`#!`)
  - 위 키워드 직후의 절대/상대 경로가 다음 allowlist 밖이면 FAIL
    - (예) `source /usr/local/bin/xxx`, `bash ../../external.sh`, `exec /opt/tool` 등
  - `http://` 또는 `https://` URL 문자열이 명령어 인자로 사용 (예: `curl https://...` — HI-01과 중복 탐지 가능)
- 허용 경로 allowlist (실행 대상으로 등장해도 FAIL 아님):
  - `$CLAUDE_PROJECT_DIR/.claude/hooks/**`, `.claude/hooks/**` — 내부 훅 스크립트
  - `/bin/true`, `/bin/false` — 대화형 프롬프트 차단 레시피 (`.claude/hooks/README.md` 권장)
  - `/dev/null`, `/dev/stdin`, `/dev/stdout`, `/dev/stderr` — 표준 스트림
  - `/tmp`, `$TMPDIR` — 일시 파일 경로
  - 셔뱅의 `/usr/bin/env`, `/bin/bash`, `/bin/sh` — 표준 인터프리터
- 환경변수 할당(`export VAR=/path`, `VAR=/path`)은 **실행이 아니므로 검사 대상 아님**
- FAIL 시: backlog 자동 등록 (CRITICAL bugfix)
- autoFix: 불가

#### HI-03. hooks 필드 JSON 구조 유효성 (MINOR)
- 사전 조건: `.claude/settings.json` 존재
- 검사:
  - JSON 파싱 성공 확인
  - `.claude/schemas/project.schema.json`의 `definitions.hookMatcher` 구조와 대조
    (SessionStart/PostToolUse/Stop 등 각 이벤트 배열이 `{matcher?, hooks: [{type, command, timeout?}]}` 형태)
  - `hooks[].hooks[].type`이 `"command"`로 설정되어 있는지
  - `timeout` 값이 양의 정수이고 **60초 이내** (Claude Code SessionStart 기본값 30초 × 2배 여유)
    - 근거: 현 레포 훅 timeout은 SessionStart=30, Stop=15, PostToolUse=10이며, 60초 초과는 블로킹 UX 저하 우려
- autoFix: 불가 (수동 수정 안내)
- 주의: project.schema.json과 Claude Code 공식 스키마의 양쪽 대조는 향후 확장 (phase-1-plan.md §스키마 소유권 계약 참조)

#### HI-04. 훅 비블로킹 규칙 위반 (MAJOR)
- 사전 조건: `.claude/hooks/*.sh` 1개 이상 존재
- 검사: Grep 기반 인라인 수행 (allowed-tools 제약으로 임의 bash 실행 불가)
  - `exit 2` 검출 (주석 제외) — Claude Code "블록" 시그널
    - 정규식: `^[[:space:]]*[^#[:space:]][^#]*\bexit[[:space:]]+2\b`
  - `set -e`, `set -eu`, `set -euo pipefail` 등 단독 사용 검출 (`|| true` 동반 없음)
    - 정규식: `^[[:space:]]*set[[:space:]]+[^#]*-[a-zA-Z]*e([^a-zA-Z]|$)` 매칭 후 `|| true` 미동반 라인만
  - `.claude/hooks/tests/`는 fixture 포함으로 제외
- 위반 시: 파일:라인 리포트 포함
- FAIL 시: backlog 자동 등록 (MAJOR improvement)
- autoFix: 불가 (스크립트 수동 리팩토링 필요)
- 참조: TFT R4 — 훅 `exit 2`/`set -e` 사용 시 세션 차단 위험. 동일 로직은 `scripts/check-hook-blocking.sh`가 CI에서 실행하므로 로컬 상시 확인 가능

### 카테고리: compliance (도메인 조건부 — fintech만 해당)

아래 항목들은 project.json의 domain이 "fintech"일 때만 실행된다.
파일 패턴 규칙은 security 카테고리와 동일 (techStack 맥락 판단, 0건이면 SKIP).

#### FIN-01. 감사 로그 존재 (CRITICAL)
- 검사: 코드에서 감사 로그 어노테이션/서비스 패턴 탐지
  - Kotlin/Java: @AuditLog, @Audited, AuditEvent, auditService
  - TypeScript: @AuditLog, auditLogger, audit.log
  - 하나라도 있으면 PASS (any scope)
- 참조: fintech/checklists/compliance.md "감사 추적" 항목의 자동화 사전 검증
- FAIL 시: backlog 자동 등록

#### FIN-02. 멱등성 키 (MAJOR)
- 검사: 결제 관련 Controller에 멱등성 키 파라미터 존재 확인
  - 대상 파일: *Payment*Controller*, *Order*Controller* 등 (techStack 맥락 판단)
  - 패턴: idempotencyKey, idempotency-key, Idempotent, X-Idempotency-Key
  - 대상 파일이 없으면 SKIP
  - 대상 파일 각각에 패턴이 존재해야 PASS (each scope)
- 참조: fintech/checklists/domain-logic.md "멱등성 키 필수"

#### FIN-03. 금액 정밀도 (MAJOR)
- 검사: 금액 관련 변수에 Double/Float 사용 금지
  - 패턴: Double.*amount, Float.*amount, double.*price, float.*price
  - domain 모델 파일 대상 (techStack 맥락 판단)
  - 하나라도 매칭되면 FAIL, 매칭 위치 리포트 포함
- 참조: fintech/checklists/domain-logic.md "BigDecimal 필수"

#### FIN-04. 트랜잭션 관리 (MAJOR)
- 검사: 결제 서비스에 트랜잭션 관리 존재 확인
  - Kotlin/Java: @Transactional, transactionTemplate, TransactionStatus
  - TypeScript: transaction, beginTransaction, prisma.$transaction
  - 대상: *Payment*Service* 등 (techStack 맥락 판단)
  - 대상 파일이 없으면 SKIP

## 중요 규칙

- command_run(DS-01, DS-02)에서 프로덕션 DB에 접속하는 명령어는 실행하지 마라.
- autoFix에서 confirm: true인 항목은 반드시 AskUserQuestion으로 사용자 승인을 받아라.
- security/compliance 항목의 grep 대상 파일 패턴은 techStack에 따라 Claude가 판단한다.
  SKILL.md에 모든 언어 패턴을 열거하지 않는다. Claude가 project.json의 techStack을 보고 적절한 파일 확장자와 패턴을 선택한다.
- security 카테고리(SEC-*)는 모든 도메인에서 실행된다. compliance 카테고리(FIN-*)는 fintech에서만 실행된다.
- 이 스킬은 체크리스트(.md)를 대체하지 않는다. 체크리스트는 PR 리뷰용 설계 원칙이고,
  이 스킬은 코드 패턴의 자동 사전 탐지다. "참조" 필드로 관련 체크리스트 항목을 연결한다.

## 실행 로그
execution-log.json에 기록:
- action: "health_check_started" | "health_check_completed"
- details: { mode, score, grade, criticalCount, fixCount }
