---
name: skill-review-pr
description: PR 리뷰 - GitHub PR에 대한 5관점 통합 리뷰 수행. 사용자가 "PR 리뷰해줘" 또는 /skill-review-pr을 요청할 때 사용합니다.
disable-model-invocation: false
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
| `config --reset` | 디폴트(full) 복원 |

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
```
📋 리뷰 모드 설정
─────────────────
모드: full (디폴트)
에이전트: domain, security, test

변경: /skill-review-pr config --mode standard
커스텀: /skill-review-pr config --agents domain,test
초기화: /skill-review-pr config --reset
```

### config 서브커맨드 감지 후 STOP — 아래 리뷰 플로우 진행 금지.

---

## 리뷰 모드 해석 (에이전트 결정)

리뷰 실행 시 에이전트 목록을 다음 우선순위로 결정:
1. `--mode` CLI 옵션 (PR 단위 오버라이드)
2. `project.json`의 `review.agents` (커스텀)
3. `project.json`의 `review.mode` (프리셋)
4. 디폴트: `full`

**프리셋 → 에이전트 매핑**:
| 모드 | 에이전트 |
|------|---------|
| `full` | domain, security, test |
| `standard` | domain, security |

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재
2. backlog.json 존재 + 유효 JSON
3. PR 번호 지정됨
4. PR 존재 + OPEN 상태 (`gh pr view --json state`)
5. Draft 아님

## 경량 점검
CLAUDE.md "경량 점검 프로토콜" 3단계 실행: ①PR-backlog 일치 ②Stale 감지 ③Intent 복구

## 워크플로우 진행 표시
CLAUDE.md 진행 표시 프로토콜. 현재 단계: "코드 리뷰 중 (보안/도메인/테스트 3관점)"

## 워크플로우 상태 추적
CLAUDE.md 상태 추적 패턴. currentSkill="skill-review-pr"

## 리뷰 전 컨벤션 로딩
1. PR 변경 파일 확인 (`gh pr view {N} --json files`)
2. CLAUDE.md 트리거 테이블로 매칭 컨벤션 식별
3. 도메인 체크리스트 Read: `_base/checklists/common.md`(필수) + `{domain}/checklists/`

## 경량 리뷰 판정 (Trivial PR Fast Path)

PR 정보 수집(Step 1) 후 아래 조건을 **모두** 만족하면 3-agent 리뷰를 스킵하고 직접 리뷰한다:
1. 변경 줄 수: additions + deletions ≤ 50
2. 변경 파일: src/ 코드 파일 변경 0건 (문서, 설정, 버전 파일만 변경)
3. 변경 내용: 보안 키워드 미포함 (password, secret, token, auth, cors, sql, inject)

**경량 리뷰 플로우**: Step 1 → Step 2(체크리스트) → Step 4~7 (Step 2.5 Rules 로드 및 서브에이전트 스킵, 직접 diff 확인 후 결정)
리포트에 "ℹ️ Trivial PR — 경량 리뷰 적용" 표시.

조건 미충족 시 일반 플로우(Step 2.5 Rules 로드 + 3-agent 병렬 리뷰) 진행.

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

**Trivial 경량 리뷰 시 SKIP** (서브에이전트 미호출이므로 전달 불필요).

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

| sub-agent | 파일 | 관점 | 모드 |
|-----------|------|------|------|
| pr-reviewer-domain | `.claude/agents/pr-reviewer-domain.md` | 도메인 + 아키텍처 | 항상 |
| pr-reviewer-security | `.claude/agents/pr-reviewer-security.md` | 보안 + 컴플라이언스 | full, standard |
| pr-reviewer-test | `.claude/agents/pr-reviewer-test.md` | 테스트 품질 | full만 |

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

### 4. 결과 병합
이슈 ID 재채번: CRITICAL→C001~, MAJOR→H001~, MINOR→M001~
위반 항목 통합 테이블 (체크리스트, 항목, 심각도, 파일:라인)
CRITICAL 1개 이상 → 전체 REQUEST_CHANGES

### 5. PR 코멘트 작성
- 코멘트 본문 최상단에 "리뷰 모드 헤더" + (rules_paths 비어있지 않을 때만) "적용 Rules 헤더" 삽입 — Claude의 응답 출력만이 아니라 실제 PR 코멘트 본문에도 반드시 포함.
`gh pr comment` — 전체 요약 (관점별 상태/이슈 수, 체크리스트 결과, 주요 피드백)
`gh api repos/.../pulls/{N}/comments` — 이슈별 인라인 코멘트 (심각도, 설명, 권장 수정 코드)

### 6. 리뷰 결정
**자기 PR 감지**: PR author == 현재 user → 승인 불가, COMMENT로 대체
- CRITICAL 0개 + 타인 PR → `gh pr review --approve`
- CRITICAL 0개 + 자기 PR → `gh pr review --comment` (승인 SKIP)
- CRITICAL 1개+ → `gh pr review --request-changes`

### 6.5 실행 로그
execution-log.json: APPROVED → action="approved", REQUEST_CHANGES → action="request_changes"

### 7. 다음 스킬

#### 기본 모드
- APPROVED → `Skill tool: skill="skill-merge-pr", args="{prNumber}"`
- REQUEST_CHANGES → 종료, "수정 후 재실행" 안내

#### --auto-fix 모드
- CRITICAL 0개 → 일반 승인 플로우
- CRITICAL 1개+ → workflowState.fixLoopCount 증가 후 `Skill tool: skill="skill-fix", args="{prNumber}"`
  - fixLoopCount 3회째 CRITICAL → skill-fix 호출 금지, REQUEST_CHANGES 즉시 중단 (루프 가드)
  - 직접 코드 수정 금지. skill-fix 없이 REQUEST_CHANGES 후 종료 금지.

## 출력
필수 포함: PR 번호/제목/작성자/브랜치, **리뷰 모드 + 실행 에이전트 목록**, **적용 Rules**(있을 때만), 체크리스트 결과, 관점별 리뷰 테이블(CRITICAL/MAJOR/MINOR 수), 주요 피드백 목록, 결정(APPROVED/REQUEST_CHANGES), 다음 자동 스킬

### 리뷰 모드 헤더 (PR 코멘트 최상단)
```
🔍 리뷰 모드: standard (2/3 에이전트)
   실행: domain, security | 미실행: test
   설정 변경: /skill-review-pr config --mode full
```

### 적용 Rules 헤더 (rules_paths가 비어있지 않을 때만, 리뷰 모드 헤더 다음 줄)
```
📋 적용 Rules: healthcare/python (1개) — phi-logging-guard.md
```
- `rules_paths`가 비어있거나 Trivial 경량 리뷰면 본 헤더 자체를 출력하지 않는다 (노이즈 방지).

## 에러 복구
CLAUDE.md "에러 복구 프로토콜" 참조. 미존재 시 3회 재시도 후 사용자 보고.

## 주의사항
- Draft PR은 리뷰 불가
- CRITICAL 이슈는 반드시 수정 필요
- 자기 PR은 GitHub 정책상 승인 불가 → COMMENT 후 머지 진행
