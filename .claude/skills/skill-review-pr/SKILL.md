---
name: skill-review-pr
description: PR 리뷰 - GitHub PR에 대한 5관점 통합 리뷰 수행. 사용자가 "PR 리뷰해줘" 또는 /skill-review-pr을 요청할 때 사용합니다.
disable-model-invocation: false
model: opus
allowed-tools: Bash(git:*), Bash(gh:*), Read, Write, Glob, Grep, Task, AskUserQuestion
argument-hint: "{PR번호} [--auto-fix] [--mode standard|full] | config [--mode standard|full] [--agents domain,security,test] [--reset]"
complexity-hint: heavy
---

# skill-review-pr: PR 리뷰

## 실행 조건
- 사용자가 `/skill-review-pr {번호}` 또는 "PR {번호} 리뷰해줘" 요청 시
- `--auto-fix`: CRITICAL 이슈 자동 수정 후 재리뷰
- `--mode standard|full`: 이번 PR만 지정 모드로 리뷰 (일회성)
- `/skill-review-pr config`: 리뷰 모드 설정 관리

## 리뷰 모드 설정 (config 서브커맨드)

`/skill-review-pr config` 로 진입. 일반 리뷰 플로우와 분기된다.

### 명령어
| 명령어 | 동작 |
|--------|------|
| `config` | 현재 설정 표시 |
| `config --mode standard` | 프리셋 변경 (standard: domain+security) |
| `config --mode full` | 프리셋 변경 (full: 전체 3 에이전트) |
| `config --agents domain,security` | 커스텀 에이전트 조합 설정 |
| `config --agents domain,test` | 커스텀 에이전트 조합 설정 |
| `config --reset` | `review` 섹션 삭제 (자동 Tier 분류 활성화) |

### 실행 로직
1. `project.json` 읽기
2. 인자 파싱:
   - 인자 없음 → 현재 설정 표시 후 종료
   - `--mode` → `project.json`의 `review.mode` 업데이트, `review.agents` 삭제
   - `--agents` → 쉼표 구분 파싱, domain 필수 검증, `project.json`의 `review.agents` 업데이트, `review.mode` 삭제
   - `--reset` → `project.json`에서 `review` 섹션 전체 삭제
3. `project.json` 저장 (metadata.updatedAt 갱신)
4. 변경 결과 표시

### 설정 저장 형식 (project.json)
```json
{
  "review": {
    "mode": "standard"
  }
}
```
또는 커스텀:
```json
{
  "review": {
    "agents": ["domain", "security"]
  }
}
```

### 유효성 검증
- 유효 에이전트: `domain`, `security`, `test`
- **domain은 필수** — 누락 시 자동 추가 + "⚠️ domain은 필수 에이전트입니다. 자동 추가됨" 경고
- `--mode`와 `--agents` 동시 사용 불가 → 에러
- 잘못된 에이전트명 → 에러 + 유효 목록 안내

### 현재 설정 표시 형식

`project.json`에 `review` 섹션 유무에 따라 분기 출력.

**(A) review 미설정** — 자동 Tier 분류 적용:
```
📋 리뷰 모드 설정
─────────────────
모드: 자동 Tier 분류 (디폴트) — PR 특성에 따라 T0/T1a/T1b/T2/T3 자동 결정
에이전트: PR마다 0~3개 가변 (Tier 표 참조)

명시 변경: /skill-review-pr config --mode standard
커스텀:    /skill-review-pr config --agents domain,test
```

**(B) review.mode 또는 review.agents 명시** — 자동 분류 OFF:
```
📋 리뷰 모드 설정
─────────────────
모드: standard (명시)
에이전트: domain, security

자동 분류 복원: /skill-review-pr config --reset
변경:          /skill-review-pr config --mode full
커스텀:        /skill-review-pr config --agents domain,test,security
```

### config 서브커맨드 감지 후 STOP — 아래 리뷰 플로우 진행 금지.

---

## 리뷰 모드 해석 (에이전트 결정)

리뷰 실행 시 에이전트 목록을 다음 우선순위로 결정:
1. `--mode` CLI 옵션 (PR 단위 오버라이드)
2. `project.json`의 `review.agents` (커스텀)
3. `project.json`의 `review.mode` (프리셋)
4. **자동 Tier 분류** (아래 "자동 Tier 분류" 섹션 참조)

**프리셋 → 에이전트 매핑**:
| 모드 | 에이전트 |
|------|---------|
| `full` | domain, security, test |
| `standard` | domain, security |

> 4단계 자동 Tier 분류는 사용자가 `project.json`에 `review` 섹션을 명시하지 않은 경우에만 적용된다. `review.mode` 또는 `review.agents`가 설정되어 있으면 자동 분류는 비활성화된다 (사용자 의도 우선).

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재
2. backlog.json 존재 + 유효 JSON
3. PR 번호 지정됨
4. PR 존재 + OPEN 상태 (`gh pr view --json state`)
5. Draft 아님

## 경량 점검
CLAUDE.md "경량 점검 프로토콜" 3단계 실행: ①PR-backlog 일치 ②Stale 감지 ③Intent 복구

## 워크플로우 진행 표시
CLAUDE.md 진행 표시 프로토콜. 현재 단계: "코드 리뷰 중 ({Tier 라벨 또는 모드 이름} — {N} 에이전트)"

## 워크플로우 상태 추적
CLAUDE.md 상태 추적 패턴. currentSkill="skill-review-pr"

## 리뷰 전 컨벤션 로딩
1. PR 변경 파일 확인 (`gh pr view {N} --json files`)
2. CLAUDE.md 트리거 테이블로 매칭 컨벤션 식별
3. 도메인 체크리스트 Read: `_base/checklists/common.md`(필수) + `{domain}/checklists/`

## 자동 Tier 분류 (sub-agent 수 자동 결정)

PR 정보 수집(Step 1) 후 PR 특성을 기반으로 sub-agent 호출 수를 자동 조정한다. **`project.json`에 `review` 섹션(`review.mode` 또는 `review.agents`)이 명시되어 있으면 본 분류는 비활성화되고 "리뷰 모드 해석"이 우선한다.**

### Tier 판정 (위에서 아래로 첫 매치 적용)

| Tier | 조건 | sub-agent | 라벨 |
|------|------|-----------|------|
| **T1a** | 변경 파일 1건 이상 · 100% 테스트 파일 변경 · ≤200줄 · 보안 키워드 0 | 1 (`pr-reviewer-test`) | Test-only |
| **T1b** | 변경 파일 1건 이상 · 100% 의존성 매니페스트 변경 · src/ 변경 0건 · 보안 키워드 0 | 1 (`pr-reviewer-security`) | Deps-only |
| **T0** | 변경 파일 1건 이상 · ≤50줄 · src/ 변경 0건 · 보안 키워드 0 | 0 (직접 리뷰) | Trivial |
| **T3** | >200줄 **OR** 보안 키워드 hit **OR** criticalPaths 매치 | 3 (domain+security+test) | Full |
| **T2** | 그 외 (catch-all 기본값) | 2 (domain+security) | Standard |

> **순서 의도**: 작은 특수 케이스(T1a/T1b)를 T0보다 먼저 평가해야 30줄 test/deps PR이 0-agent로 흡수되지 않음. T3가 T2 위인 이유는 T3가 양성 조건(OR), T2는 음성 catch-all이라서. 변경 파일 0건(rebase-only, mode-change-only 등) PR은 T1a/T1b/T0 모두 "1건 이상" 조건으로 자연 탈락 → T3 미매치 → T2 catch-all에서 사람 검토 흐름으로 진입.

### 패턴 정의

**테스트 파일** (T1a):
- 디렉토리: `tests/**`, `test/**`, `__tests__/**`, `src/test/**` (Maven/Gradle)
- 파일명: `**/*.{test,spec}.{js,ts,jsx,tsx,mjs,cjs}`, `**/*_test.{py,go}`, `**/test_*.py`, `**/*Test.{java,kt}`, `**/*Spec.{java,kt,groovy}`

**의존성 매니페스트** (T1b):
- JS/TS: `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`
- Python: `requirements*.txt`, `pyproject.toml`, `poetry.lock`, `Pipfile`, `Pipfile.lock`
- JVM: `pom.xml`, `build.gradle`, `build.gradle.kts`, `gradle.lockfile`
- Go/Rust: `go.mod`, `go.sum`, `Cargo.toml`, `Cargo.lock`
- 기타: `composer.json`, `composer.lock`, `Gemfile`, `Gemfile.lock`

**보안 키워드** (대소문자 무관, **변경 파일 경로 부분문자열 매치만**): `password`, `secret`, `token`, `auth`, `cors`, `sql`, `inject`
- diff 본문은 매치 대상 아님 (false-positive 폭발 방지 — `// @author` 주석, SQL 마이그레이션 키워드, DI `@Inject` 등이 자동 T3 격상되지 않도록)
- 매치 예: `src/auth/`, `oauth-routes.ts`, `token-bucket.ts`, `migrations/202xx-add-sql-index.sql`은 hit. `src/profile.ts` 내부에 `"password"` 문자열만 있는 경우는 hit 아님
- 코드 본문 secret 누출 검출은 별도 secret-scanning 책임 영역 (본 분류기 범위 밖)

**criticalPaths** (옵셔널):
- `.claude/domains/{domain}/domain.json`에 `criticalPaths: ["src/payment/**", ...]` 배열이 있으면 변경 파일과 글롭 매치 검사
- 도메인 메타에 미정의면 본 트리거는 자연 SKIP (schema 변경 별도)

### Tier별 플로우
- **T0**: Step 1 → 2(체크리스트) → 4~7 (Step 2.5 + sub-agent 스킵, 직접 diff 확인 후 결정)
- **T1a / T1b**: Step 1 → 2 → 2.5 → 3(단일 sub-agent) → 4~7
- **T2 / T3**: Step 1 → 2 → 2.5 → 3(다중 sub-agent) → 4~7

> PR 코멘트 최상단 출력 형식은 "출력 → 분류 헤더" 섹션 참조 (SSOT).

---

## 실행 플로우

### 1. PR 정보 수집
`gh pr view {N} --json title,body,author,state,baseRefName,headRefName,files,additions,deletions`
`gh pr diff {N} > /tmp/pr-{N}-diff.txt`, `gh pr checks {N}`
diff는 임시 파일에 저장하여 에이전트가 Read로 참조하도록 한다 (프롬프트 포함 금지).

**diff 파일 생명주기**:
- 생성: Step 1에서 `gh pr diff` 결과 저장
- 공유: Step 3에서 3개 에이전트가 동일 파일 Read (재fetch 없음)
- 갱신: auto-fix 후 재리뷰 시에만 `gh pr diff`로 덮어쓰기 (코드가 변경되었으므로)
- 유지: 리뷰 프로세스 중 파일 삭제 금지 — 반복 작업 시 재활용
- 정리: PR 머지 완료 시 `rm /tmp/pr-{N}-diff.txt`

### 2. 체크리스트 검증
| 항목 | 검증 방법 | 필수 |
|------|----------|------|
| 빌드 성공 | CI 결과 | ✅ |
| 테스트 통과 | CI 결과 | ✅ |
| 린트 통과 | CI 결과 | ⚠️ |
| 라인 수 제한 | diff 분석 | ⚠️ |
| 충돌 없음 | mergeable | ✅ |

### 2.5. 도메인 × 언어 Rules 로드 (Phase 4)

`.claude/rules/{domain}/{language}/`에 도메인 비즈니스 제약 파일이 있으면 자동 참조.

**T0(Trivial) 시 SKIP** (서브에이전트 미호출이므로 전달 불필요). T1a/T1b도 도메인 에이전트가 호출되지 않으므로 `rules_paths` 전달 불필요(자연 SKIP).

#### 절차
1. `project.json`에서 `domain`, `techStack.backend` 읽기. 둘 중 하나라도 부재 시 SKIP.
2. **language 매핑**: `.claude/rules/README.md`의 "language 매핑 (SSOT)" 표를 Read로 로드 후 `techStack.backend` 값을 매칭하여 디렉토리명 도출. 표에 없는 값(`none` 포함)은 SKIP. 본 SKILL.md에 매핑 표를 복제하지 않음 — README가 단일 진실 소스(drift 방지).
3. `.claude/rules/{domain}/{language}/*.md` 글롭 (예: `find .claude/rules/healthcare/python -name '*.md' -type f`).
4. 매칭 파일 경로를 `rules_paths` 리스트에 수집.
5. **부재 시 SKIP** — 디렉토리 자체가 없거나 매칭 0개면 기존 동작 유지(에이전트에 빈 목록 전달 X).
6. `_example/_example/` 경로는 매핑 표에 없으므로 자연 SKIP.

#### 출력
`rules_paths`가 비어있지 않을 때만 PR 코멘트 헤더에 표시:
```
📋 적용 Rules: {domain}/{language} ({N}개) — {파일명1}, {파일명2}
```

#### 적용 대상 에이전트
- **pr-reviewer-domain**: `rules_paths` 전달 → 도메인 비즈니스 제약 검토에 활용
- **pr-reviewer-security**: 미전달 (보안 영역은 Phase 5 범용 보안과 분리)
- **pr-reviewer-test**: 미전달

### 3. N관점 병렬 리뷰 (모드 기반 sub-agent 선택)

**에이전트 결정**: "리뷰 모드 해석" 섹션의 우선순위로 실행할 에이전트 목록 결정.
결정된 에이전트만 **하나의 메시지에서 동시 호출**:

| sub-agent | 파일 | 관점 | 호출 조건 (모드 / Tier) |
|-----------|------|------|------|
| pr-reviewer-domain | `.claude/agents/pr-reviewer-domain.md` | 도메인 + 아키텍처 | 모드: full, standard / Tier: T2, T3 |
| pr-reviewer-security | `.claude/agents/pr-reviewer-security.md` | 보안 + 컴플라이언스 | 모드: full, standard / Tier: T1b, T2, T3 |
| pr-reviewer-test | `.claude/agents/pr-reviewer-test.md` | 테스트 품질 | 모드: full / Tier: T1a, T3 |

각 Task: Read로 agent 파일 로드 후 지침에 따라 리뷰.
**토큰 절감**: PR diff를 프롬프트에 직접 포함하지 않는다. 대신 에이전트에게 다음을 전달:
- 변경 파일 목록 (파일명 + additions/deletions 수)
- diff 파일 경로: `/tmp/pr-{N}-diff.txt`
- **rules 파일 경로 목록 (`rules_paths`) — pr-reviewer-domain 에이전트에만 전달** (Step 2.5에서 수집). 비어있으면 미전달.
- 에이전트는 해당 파일을 Read로 자유롭게 참조한다 (시야 제한 없음).

| 항목 | 값 |
|------|-----|
| timeout | 60초 |
| retry | 0회 (--auto-fix 시 자동 1회 재시도 후 스킵) |
| fallback | "⚠️ {에이전트명} 분석 불가 — 수동 확인 필요" |

**오류 처리**:
- 1개 실패: AskUserQuestion (재시도/스킵/중단). --auto-fix 시 자동 재시도→실패시 스킵
- 2개+ 실패: 즉시 중단

### 3.5. Confidence 채점 (false-positive 필터)

Step 3에서 sub-agent들이 도출한 이슈 목록을 **독립 채점 단계**로 confidence 0~100 부여. self-bias 회피 목적으로 sub-agent와는 별도 호출.

#### SKIP 조건 (위에서 아래로 첫 매치)
1. **T0(Trivial) 분류** → 채점 단계 자체 SKIP. T0은 0-agent 직접 리뷰이며 결정 매트릭스도 우회한다. T0 결정 규칙(legacy 정책 보존):
   - T0 + CRITICAL ≥1 → 즉시 REQUEST_CHANGES (자기 PR 여부 무관). fix loop는 --auto-fix일 때만 진입.
   - T0 + CRITICAL=0 → APPROVE (타인 PR) / COMMENT (자기 PR).
   - T0에선 confidence·강등·드롭·매트릭스 개념 전체가 적용되지 않음. Confidence 필터 헤더 미출력. 본문에 '[T0 직접 리뷰]' 표시.
2. **이슈 0개** → SKIP. 자연 통과 (REQUEST_CHANGES 트리거 없음). Confidence 필터 헤더 미출력.

#### Step 3 결과 → 이슈 리스트 정규화 (Step 3.5 진입 직전)

Step 3 sub-agent들이 반환한 markdown 표 + prose를 다음 정규식 규약으로 추출:
- **표 row 매치**: pipe-delimited 행에서 severity / file:line / description 칼럼 추출. severity는 `CRITICAL|MAJOR|MINOR` 대소문자 무관 매치.
- **prose 흡수**: 표 다음 줄의 들여쓰기/bullet/code-block을 직전 row의 description에 합침.
- 정규화 결과 schema:
```json
{
  "id": "<sub-agent가 부여한 ID 또는 자동 부여>",
  "severity": "CRITICAL|MAJOR|MINOR",
  "file": "src/path/file.ts",
  "line": 42,
  "description": "...(multi-line OK)",
  "source_agent": "domain|security|test"   // 정규화 — 항상 이 3개 enum 중 하나
}
```
- 파싱 실패 row는 로그하고 다음 row로 진행 (전체 실패 X).

#### 절차
1. 위 정규화 룰로 이슈 리스트 구성.
2. 각 이슈를 별도 Task로 채점 호출. **동시 채점 Task ≤ 10** (chunk 순차). **총 채점 Task ≤ 30 (절대 상한)** — 초과 시 상위 30개(severity CRITICAL > MAJOR > MINOR 순, 동일 severity 내 sub-agent 보고 순)만 채점하고 나머지는 `confidence = critical 임계치 값`으로 보수적 처리(원래 severity 보존, 결정 매트릭스 그대로 적용). PR 코멘트에 "토큰 cap으로 N개 미채점" 명시. 호출 모델은 parent 상속 (사용자 플랜 의존, 강제 지정 X). parent가 무거운 모델(Opus 등)이면 self-bias 회피 효과는 부분적 — 매트릭스 임계치를 보수적으로 두는 것으로 보완.
3. **각 채점 Task 입력**:
   - 이슈 1건 (위 schema)
   - PR diff 경로: `/tmp/pr-{N}-diff.txt`
   - **CLAUDE.md 경로** (repo 루트): 컨벤션 명시 여부 판단용
   - **매칭 컨벤션 파일 경로 목록**: Step 2의 "리뷰 전 컨벤션 로딩" 결과 재사용 (`_base/checklists/common.md` + `{domain}/checklists/`)
   - `source_agent === "domain"`이면 `rules_paths` 추가 전달
4. **채점 Task 출력 (정수 0-100 + 한 줄 근거)**. 출력 파싱 실패 / 범위 외(>100, <0, NaN, prose) / timeout 시:
   - 1회 재시도
   - 재시도 실패 시 **fallback confidence = critical 임계치 값** (디폴트 80). 채점 인프라 장애가 모든 sub-agent CRITICAL을 자동 머지 차단으로 escalate하는 위험 차단 — confidence를 임계치 경계에 두어 매트릭스가 CRITICAL은 그대로 게시, MAJOR/MINOR는 임계치 통과 여부에 따라. **로그에 "scoring-failure-fallback" 마커 명시**(사용자가 신뢰성 저하를 인지하도록).
5. **결정성 가이드** (채점 Task에 명시):
   - 동일 입력은 동일 출력 지향. (Claude Code Task tool은 temperature/seed를 노출하지 않으므로 모델 측 결정성은 비-결정적일 수 있음 — 본 가이드는 LLM에 대한 안내이며 강제 X.)
   - 임계치 경계 부근에서 ±5 올림 같은 휴리스틱 적용 X — 본 가이드의 75 anchor와 결합 시 모든 '확신' 이슈가 자동 CRITICAL로 격상되어 본 PR false-positive 필터 목적과 충돌. 채점자는 rubric anchor에 정직하게 매핑한다.

#### Confidence Rubric (채점 Task에게 그대로 전달)

> 아래 0/25/50/75/100은 **anchor 예시**이며, 채점자는 임의 정수(0~100)를 부여할 수 있다. CLAUDE.md/rules/컨벤션에 직접 명시된 위반은 **80 이상** 부여(매트릭스 critical 임계치와 정렬).

- **0**: 명백한 false positive. 가벼운 검토에도 무너지거나 PR과 무관한 기존 이슈.
- **25**: 약한 의심. 실제 이슈일 수도 있으나 검증 불가. 스타일 이슈가 CLAUDE.md/rules에 명시 안 됨.
- **50**: 실제 이슈지만 minor nitpick. PR 맥락에서 영향 작음.
- **75**: 확신 — 실무에서 발현될 가능성 높음 (단, 컨벤션 명시 위반은 80+ 부여).
- **80~99**: CLAUDE.md/rules/컨벤션에 직접 명시된 위반. 머지 차단 가치 있음.
- **100**: 확정 — 증거가 직접 입증.

#### False-positive 가이드 (채점 Task에게 전달)
- PR과 무관한 pre-existing 이슈
- 버그처럼 보이지만 실제 버그 아닌 패턴
- 시니어 엔지니어가 지적 안 할 nitpick
- 린터/타입체커/컴파일러가 잡을 이슈 (별도 CI)
- CLAUDE.md/rules에 명시 안 된 일반 품질 이슈
- 코드에서 명시적 silence된 항목 (lint ignore 주석 등)
- 사용자가 수정하지 않은 라인의 이슈

### 4. 결과 병합 + 결정 매트릭스

#### 이슈 ID 채번 시점
**채점 + 매트릭스 적용 후 최종 게시 카테고리 기준으로 채번**: CRITICAL(게시)→C001~, MAJOR(게시)→H001~, MINOR(게시)→M001~. 강등된 항목은 강등 후 카테고리(MAJOR)에서 채번(H{NNN}). 인라인 코멘트와 본문 테이블 ID 일관성 보장.

위반 항목 통합 테이블 (체크리스트, 항목, 심각도, confidence, 파일:라인). 강등된 항목은 description 앞에 `[원래 CRITICAL · 강등]` 접두 추가.

#### 결정 매트릭스 (severity × confidence)

임계치는 `project.json`의 `review.thresholds`에서 로드. **각 키 독립 fallback**: 누락 키만 디폴트 적용.

> **디폴트 값 SSOT**: `project.schema.json`의 `properties.review.thresholds.{critical,major,minor}.default` 필드. 본 문서가 인용하는 80/60/50은 **schema 기본값의 사본**이며, schema 갱신 시 본 문서의 모든 80/60/50 표기를 함께 갱신해야 한다 (`grep -nE '\\b(80|60|50)\\b' .claude/skills/skill-review-pr/SKILL.md`로 위치 확인). 임계치 schema가 critical 최소 50을 강제 (project.schema.json).

> **Ordering sanity check (Step 4 진입 직전 필수)**: 로드된 임계치가 `critical ≥ major ≥ minor` 조건 위반(예: critical=60, major=90) 시 **디폴트 80/60/50으로 강제 복원 + PR 코멘트 헤더에 경고**: "⚠️ thresholds ordering 위반 → 디폴트(80/60/50)로 강제. project.json의 review.thresholds 수정 필요". JSON Schema는 cross-field 비교 불가이므로 본 단계가 마지막 방어선.

| severity (Step 3) | confidence | 처리 |
|----------|-----------|------|
| CRITICAL | ≥ critical (디폴트 80) | **게시 + REQUEST_CHANGES 트리거** |
| CRITICAL | < critical | **MAJOR로 강등 게시** (드롭 X). **major threshold 재검 X — 강등 CRITICAL은 confidence 무관하게 항상 게시**. REQUEST_CHANGES 트리거 안 함. 단, 강등 카운트는 별도 추적 |
| MAJOR (Step 3에서 처음부터 MAJOR) | ≥ major (디폴트 60) | 게시 |
| MAJOR (위와 동) | < major | 드롭 |
| MINOR | ≥ minor (디폴트 50) | 게시 |
| MINOR | < minor | 드롭 |

> **강등 CRITICAL ≠ 원래 MAJOR**: 매트릭스에서 두 카테고리를 분리해서 평가. 강등은 major threshold 무시(드롭 위험 차단), 원래 MAJOR는 normal threshold 적용. 이 분리가 누락되면 finding #3 매트릭스 모순 재발.

**REQUEST_CHANGES 트리거 (SSOT)**: CRITICAL × confidence ≥ critical 이슈가 **1개 이상**일 때만. 매트릭스 강등으로 CRITICAL이 0개가 되어도 강등 카운트가 ≥1이고 자기 PR이면 **sticky 경고**(아래 Step 6 참조). Step 6/7은 본 SSOT를 참조한다.

#### Confidence 필터 헤더 (PR 코멘트 본문 — 분류 헤더 다음 줄)

채점이 실행된 경우 **항상 출력**(투명성). T0/이슈 0개로 SKIP된 경우만 미출력.

```
🎯 Confidence 필터: 12개 발견 → 5개 게시 (드롭 6, 강등 1) | 임계치: critical=80 major=60 minor=50 (디폴트)
```

- 임계치 표시: review.thresholds 명시 시 `(project.json)`, 미설정 또는 일부 키만 명시 시 `(디폴트)` 또는 `(혼합)` — fallback 명시.
- 드롭 0 + 강등 0이어도 헤더 출력 (audit-trail). 메시지를 `12개 발견 → 12개 게시 (필터 통과)` 형태로.

### 5. PR 코멘트 작성

#### 헤더 순서 (위에서 아래)
1. **분류 헤더** (명시 `review` 설정 시 "리뷰 모드 헤더", 자동 분류 시 "Tier 헤더")
2. **Confidence 필터 헤더** (채점이 실행된 경우, T0/이슈 0개 SKIP 시 미출력)
3. **강등 CRITICAL 경고 헤더** (강등 카운트 ≥1일 때만, 자기 PR이면 더 강조)
4. **적용 Rules 헤더** (rules_paths가 비어있지 않을 때만)

> 위 순서는 SSOT. T0(Trivial)은 헤더 1만 출력.

#### 강등 CRITICAL 경고 헤더 (신규)

매트릭스에서 CRITICAL이 MAJOR로 강등된 항목이 1개 이상일 때 노출:

```
⚠️ 강등된 CRITICAL N개 — sub-agent가 CRITICAL로 도출했으나 채점자가 confidence < critical 임계치로 판단.
   사람 검토 필요. 머지 전 본문의 [원래 CRITICAL · 강등] 항목 확인.
```

자기 PR이면 다음 sticky 경고를 추가로 prepend:

```
🛑 자기 PR + 강등 CRITICAL — 자동 머지 chain 차단. 사람 검토 후 수동 머지하세요.
```

#### 본문 카운트 일관성
- 관점별 리뷰 테이블 / 본문 요약 / 결정 라인의 CRITICAL/MAJOR/MINOR 수는 **모두 매트릭스 적용 후(필터 후) 기준**. 강등된 CRITICAL은 MAJOR 카운트에 포함 + 별도 "강등 N건" 보조 표시.
- 채점 실패로 confidence=100 fallback된 항목도 동일하게 카운트.

`gh pr comment` — 전체 요약 (관점별 상태/이슈 수 — 필터 후, 체크리스트 결과, 주요 피드백 — 이슈별 confidence 점수 병기)
`gh api repos/.../pulls/{N}/comments` — 이슈별 인라인 코멘트 (라벨은 아래 "인라인 코멘트 라벨 형식 (SSOT)" 준수, 설명, 권장 수정 코드)

#### 인라인 코멘트 라벨 형식 (SSOT — skill-fix 파싱 계약)

인라인 코멘트(`gh api .../pulls/{N}/comments`)의 본문 **첫 줄**은 다음 라벨로 시작한다. **본 섹션이 최종 게시 라벨 형식의 단일 진실 소스**이며, `skill-fix` Step 2가 이 형식을 정규식으로 파싱한다. sub-agent가 emit하는 markdown 표 셀 텍스트(`CRITICAL`/`MAJOR`/`MINOR`)는 중간 산출물일 뿐 — 인라인 코멘트로 게시될 때의 라벨은 본 SSOT가 결정한다.

| 게시 카테고리 (필터 후) | 인라인 코멘트 첫 줄 라벨 |
|------------------------|------------------------|
| CRITICAL (정상 게시, confidence ≥ critical) | `🔴 **CRITICAL**` |
| MAJOR (처음부터 MAJOR, 정상 게시) | `🟠 **MAJOR**` |
| MINOR (정상 게시) | `🟡 **MINOR**` |
| CRITICAL → MAJOR 강등 | `🟠 **MAJOR** [원래 CRITICAL · 강등]` |

- **강등 항목**은 MAJOR 라벨로 렌더하되 **반드시 `[원래 CRITICAL · 강등]` 마커를 라벨과 같은 줄에 병기**한다. 라벨 자체는 MAJOR이므로 skill-fix는 이 마커로만 강등을 식별한다(라벨만으로는 정상 MAJOR와 구분 불가).
- **confidence 점수**는 본문 **끝**에 병기한다: 예) `... confidence: 85`. 라벨 줄에 섞지 않는다(파싱 단순화 + 첫 줄 라벨 정규식 안정성).
- **이슈 ID**(`[C{NNN}]`/`[H{NNN}]`/`[M{NNN}]`, Step 4 채번 규칙)는 라벨 다음에 표기 가능하다. 강등은 `H` 채널을 사용한다.
- 이모지(`🔴`/`🟠`/`🟡`)는 시각 보조이며, skill-fix 파싱은 `**CRITICAL**` 볼드 토큰과 `[원래 CRITICAL · 강등]` 마커를 기준으로 한다(이모지 누락에도 견고하도록).

### 6. 리뷰 결정 (Step 4 매트릭스 SSOT 참조)

#### 결정 분기 (위에서 아래로 첫 매치 — CRITICAL 게시 우선, 그 다음 강등 가드, 마지막 정상)

| 조건 | 결정 | chain |
|------|------|------|
| CRITICAL(필터 후) ≥1 | `gh pr review --request-changes` (자기 PR 여부 무관) | --auto-fix 모드면 skill-fix loop, 아니면 종료 |
| CRITICAL(필터 후) 0개 + **강등 ≥1 + 자기 PR** | `gh pr review --comment` + **강등 경고 헤더(sticky)** | **자동 chain 차단 발동**(Step 7). 사용자 수동 머지 필요 |
| CRITICAL(필터 후) 0개 + 강등 ≥1 + 타인 PR | `gh pr review --approve` + 강등 경고 헤더 | **chain 진행**(throughput 보존). 사람 검토 권고는 헤더로만 |
| CRITICAL(필터 후) 0개 + 강등 0 + 타인 PR | `gh pr review --approve` | chain 진행 |
| CRITICAL(필터 후) 0개 + 강등 0 + 자기 PR | `gh pr review --comment` (자기 승인 GitHub 정책 회피) | chain 진행 가능 |

> **자기 PR + CRITICAL ≥1 + 강등 ≥1 동시 발생**: 첫 행(CRITICAL ≥1) 매치 → REQUEST_CHANGES 우선. chain 차단 가드는 두 번째 행에서만 발동 (CRITICAL=0이라는 전제 충족 시). 즉 진짜 차단해야 할 케이스는 "겉으로 CRITICAL 0개로 보이지만 채점이 약하게 본 강등만 있는" 자기 PR. 진짜 CRITICAL이 있으면 REQUEST_CHANGES가 더 강한 신호.

### 6.5 실행 로그 + workflowState 갱신
- execution-log.json: APPROVED → action="approved", REQUEST_CHANGES → action="request_changes"
- **workflowState.lastReviewDecision 갱신** (skill-fix 모드 판정 SSOT): 본 회차 결정값을 `APPROVED` / `COMMENT` / `REQUEST_CHANGES` 중 하나로 저장. skill-fix가 auto-fix vs 수동 호출 모드를 정확히 분기하기 위함(fixLoopCount 단독으로는 직전 루프 잔재가 잘못 분류).

### 7. 다음 스킬

#### 자동 chain 차단 조건 — Step 6 결정 분기의 chain 컬럼 SSOT 참조

Step 7은 별도 분기를 정의하지 않는다. **Step 6 결정 분기 표의 'chain' 컬럼이 chain 진행/차단의 SSOT**. 본 섹션은 모드별 실행 동작만 명시.

#### 기본 모드 (--auto-fix 미사용)
- Step 6 결정 = APPROVE + chain 진행 → `Skill tool: skill="skill-merge-pr", args="{prNumber}"`
- Step 6 결정 = COMMENT + chain 진행 → `Skill tool: skill="skill-merge-pr", args="{prNumber}"` (자기 PR + 강등 0 케이스만)
- Step 6 결정 = COMMENT + chain 차단 → 종료. 사용자 수동 머지 안내 (자기 PR + 강등 ≥1 케이스).
- Step 6 결정 = REQUEST_CHANGES → 종료, "수정 후 재실행" 안내.

#### --auto-fix 모드
- Step 6 결정 = APPROVE 또는 COMMENT + chain 진행 → 일반 승인 플로우 (위 기본 모드와 동일).
- Step 6 결정 = COMMENT + chain 차단 → 종료. fix loop 진입 안 함(자기 PR + 강등은 사람 검토 신호).
- Step 6 결정 = REQUEST_CHANGES → `workflowState.fixLoopCount` 증가 후 `Skill tool: skill="skill-fix", args="{prNumber}"`
  - fixLoopCount 3회째 REQUEST_CHANGES → skill-fix 호출 금지, 즉시 중단 (루프 가드).
  - 직접 코드 수정 금지. skill-fix 없이 종료 금지.

> **Confidence 매트릭스와 fix loop 결합 (SSOT)**: fix loop 진입 조건은 **Step 4 매트릭스의 'CRITICAL 게시' 행만**(confidence ≥ critical 임계치). 강등된 CRITICAL(major bypass로 게시되지만 REQUEST_CHANGES 트리거 안 함)은 fix loop 대상 아님 — false-positive CRITICAL이 confidence flip-flop으로 fixLoopCount를 소모하는 진동 차단.

## 출력
필수 포함: PR 번호/제목/작성자/브랜치, **분류 헤더(리뷰 모드 또는 Tier) + 실행 에이전트 목록**, **Confidence 필터 헤더**(채점 실행 시 항상), **강등 CRITICAL 경고 헤더**(강등 ≥1 시), **적용 Rules**(있을 때만), 체크리스트 결과, 관점별 리뷰 테이블(CRITICAL/MAJOR/MINOR 수 — **모두 필터 후 기준**), 주요 피드백 목록(이슈마다 confidence 점수 병기, 강등 항목은 `[원래 CRITICAL · 강등]` 접두), 결정(APPROVED/REQUEST_CHANGES), 다음 자동 스킬

### 분류 헤더 (PR 코멘트 최상단, 둘 중 하나만 출력)

**(A) 리뷰 모드 헤더** — `project.json`에 `review` 설정이 명시된 경우:
```
🔍 리뷰 모드: standard (2/3 에이전트)
   실행: domain, security | 미실행: test
   설정 변경: /skill-review-pr config --mode full
```

**(B) Tier 헤더** — 자동 분류가 적용된 경우 (`review` 미설정):
```
🎯 자동 분류: T2 Standard (2 에이전트) — domain, security
   강제 변경: /skill-review-pr config --mode full
```

T0(Trivial)도 동일 형식으로 `T0 Trivial (0 에이전트) — 직접 리뷰`.

### Confidence 필터 헤더 (분류 헤더 다음 줄)

Step 3.5 채점이 **실행되면 항상 출력**(T0/이슈 0개로 SKIP된 경우만 미출력). 드롭/강등 0이어도 audit-trail 목적으로 출력 — 필터 적용 여부를 사용자가 인지할 수 있도록.

```
🎯 Confidence 필터: 12개 발견 → 5개 게시 (드롭 6, 강등 1) | 임계치: critical=80 major=60 minor=50 (디폴트)
```

드롭 0 + 강등 0 케이스:
```
🎯 Confidence 필터: 12개 발견 → 12개 게시 (필터 통과) | 임계치: critical=80 major=60 minor=50 (디폴트)
```

- 임계치 출처 표시:
  - 전체 디폴트: `(디폴트)`
  - 전체 명시: `(project.json)`
  - 일부 명시(독립 fallback): `(혼합 — critical 명시, major/minor 디폴트)`

### 강등 CRITICAL 경고 헤더 (강등 카운트 ≥1 시 — Confidence 필터 헤더 다음)

```
⚠️ 강등된 CRITICAL N개 — sub-agent가 CRITICAL로 도출했으나 채점자가 confidence < critical 임계치로 판단.
   사람 검토 필요. 본문의 [원래 CRITICAL · 강등] 항목 확인.
```

자기 PR이면 **위 헤더 위에** sticky 경고 prepend:
```
🛑 자기 PR + 강등 CRITICAL — 자동 머지 chain 차단됨. 사람 검토 후 수동 머지 필요.
```

### 적용 Rules 헤더 (rules_paths가 비어있지 않을 때만 — 강등 경고 헤더 다음)
```
📋 적용 Rules: healthcare/python (1개) — phi-logging-guard.md
```
- `rules_paths`가 비어있거나 T0(직접 리뷰)이면 본 헤더 자체를 출력하지 않는다 (노이즈 방지).

## 에러 복구
CLAUDE.md "에러 복구 프로토콜" 참조. 미존재 시 3회 재시도 후 사용자 보고.

## 주의사항
- Draft PR은 리뷰 불가
- 자기 PR은 GitHub 정책상 승인 불가 → COMMENT 후 머지 진행

### 심각도별 머지 정책 (일관 규칙 — LLM 보고 시 준수)

> 모든 정책은 **Step 3.5 confidence 매트릭스 필터링 이후의 심각도** 기준. confidence 미달로 강등/드롭된 항목은 본 정책 적용 대상 아님.

- **CRITICAL (게시)**: 머지 차단. 반드시 수정 후 재리뷰. 정의: confidence ≥ critical 임계치 (디폴트 80)
- **CRITICAL → MAJOR 강등**: 머지 차단 **없음** (MAJOR 정책 적용). 채점이 약한 확신이라 판단한 경우 — 사람 검토 권장. **자기 PR + 강등 ≥1이면 자동 chain 차단 발동**(Step 7 가드)
- **MAJOR (게시)**: 머지 차단 없음. 개선 권고로 PR 코멘트에 남기되, 사용자에게 "수정 후 재리뷰"를 강요하지 않는다. 다음 PR/별도 개선 Task로 처리 가능
- **MINOR (게시)**: 참고 사항. 머지 영향 없음

> 결과 보고 시 MAJOR/MINOR를 "수정 후 재리뷰 권장"으로 표현하지 않는다. 이전 회차에서 본 표현이 있더라도 본 규칙을 우선한다. auto-fix 루프는 CRITICAL(게시)에만 적용된다 (토큰 비용 통제 + false-positive 무한 fix-redo 차단).
