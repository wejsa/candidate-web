---
name: skill-impl
description: 구현 - 스텝별 개발 + PR 생성. 사용자가 "개발 진행해줘", "구현해줘" 또는 /skill-impl을 요청할 때 사용합니다.
disable-model-invocation: false
allowed-tools: Bash(git:*), Bash(./gradlew:*), Bash(mvn:*), Bash(./mvnw:*), Bash(npm:*), Bash(yarn:*), Bash(pnpm:*), Bash(bun:*), Bash(python:*), Bash(pytest:*), Bash(ruff:*), Bash(poetry:*), Bash(pip:*), Bash(npx:*), Bash(go:*), Bash(golangci-lint:*), Read, Write, Edit, Glob, Grep, Task
argument-hint: "[--next|--all|--retry|--skip|--micro \"설명\"|--dry-run]"
complexity-hint: medium
---

# skill-impl: 구현

## 실행 조건
- 사용자가 `/skill-impl` 또는 "개발 진행해줘" 요청 시
- `--next`: 다음 스텝 (이전 PR 머지 또는 skipped 확인 필수)
- `--all`: 모든 스텝 연속 실행 (skipped 스텝은 건너뜀)
- `--retry`: 실패한 현재 스텝 재시작
- `--skip`: 빌드 실패 스텝 건너뛰기
- `--micro "설명"`: 소규모 작업 경량 경로 (plan 생략, 바로 구현→PR)
- `--dry-run`: 빌드/테스트만 실행하고 PR 미생성 (브랜치 유지)

## 사전 조건 (MUST-EXECUTE-FIRST — 하나라도 실패 시 STOP)
1. project.json 존재
2. backlog.json 존재 + 유효 JSON
3. in_progress Task 존재 (`--micro` 시 자동 생성하므로 면제)
4. 계획 파일 `.claude/temp/{taskId}-plan.md` 존재 (`--micro` 시 면제)
5. 현재 스텝 status == pending (`--micro` 시 자동 설정)
6. origin/develop 동기화: >5 뒤처짐 → STOP, 1-5 → 자동 merge
- `--next` 추가 조건: 이전 스텝 PR 머지 완료 **또는 skipped** + develop 최신 동기화

## 잠금 자동 정리 (Lock Auto-cleanup)
사전 조건 검사 중, 현재 작업 Task **외**의 `in_progress` Task를 스캔:
1. `assignedAt` + (`lockTTL` ?? 3600) < 현재 시각 → 만료 감지
2. 만료된 Task: `status` → `"todo"`, `assignee`/`assignedAt`/`lockedFiles` 초기화
3. 로그: `🔓 잠금 만료 자동 해제: {TASK-ID}`
4. 현재 작업 Task는 제외 (자기 자신의 lock은 정리하지 않음)

## 경량 점검
CLAUDE.md "경량 점검 프로토콜" 3단계 실행: ①PR-backlog 일치 ②Stale 감지 ③Intent 복구

## 워크플로우 진행 표시
CLAUDE.md 진행 표시 프로토콜. 현재 단계: "코드 구현 중 (Step {N}/{total} — {스텝명})"

## 워크플로우 상태 추적
CLAUDE.md 상태 추적 패턴. currentSkill="skill-impl"

## 컨벤션 로딩
계획 파일의 "참조 컨벤션" 필드 → Read로 로드. 없으면 CLAUDE.md 트리거 테이블로 자동 식별.

## 실행 플로우

### 1. 환경 준비
CLAUDE.md 워크트리 프로토콜 참조.
- **일반 모드**: develop checkout + pull → `feature/{taskId}-step{N}` 브랜치 생성
  - 브랜치 이미 존재 시: PR MERGED → 다음 Step 스킵, OPEN → 기존 브랜치에서 이어서 작업
- **워크트리 모드**: CS 브랜치 직접 사용, fetch + merge origin/develop
- merge 후 step 재검증: backlog.json 재읽기 → done/merged면 스킵, 다른 세션 in_progress면 경고

### 2. 계획 파일 참조
로드 순서: 도메인 참고자료 → 공통 컨벤션 → 계획 파일. 현재 스텝의 파일/구현/테스트 확인.

### 3. 코드 구현
계획에 따라 파일 생성/수정, 테스트 작성, 문서 업데이트(필요 시)

### 4. 라인 수 검증
**라인 제한 결정**: `step.prLineLimit` > `project.json conventions.prLineLimit` > 500 (폴백 체인)

| 프로필 | 진행 | 경고 | 강력 경고 | 차단 |
|--------|------|------|----------|------|
| standard | <limit×0.6 | limit×0.6~limit | limit~limit×1.4 | >limit×1.4 |
| fast | <limit | limit~min(limit×2,1000) | — | >min(limit×2,1000) |

### 5. 빌드 & 테스트
`project.json`의 `buildCommands` 우선 → 미설정 시 `techStack` 기반 폴백:

| 스택 | 빌드 | 테스트 | 린트 |
|------|------|--------|------|
| spring-boot-kotlin | `./gradlew build` | `./gradlew test` | `./gradlew ktlintCheck` |
| spring-boot-java (Gradle) | `./gradlew build` | `./gradlew test` | `./gradlew checkstyleMain` |
| spring-boot-java (Maven) | `mvn package` | `mvn test` | `mvn checkstyle:check` |
| nodejs-typescript | `npm run build` | `npm test` | `npm run lint` |
| python-fastapi | - | `pytest` | `ruff check .` |
| python-django | `python manage.py check` | `pytest` | `ruff check .` |
| go | `go build ./...` | `go test ./...` | `golangci-lint run` |
| nextjs | `next build` | `vitest` 또는 `jest` | `next lint` |
| react-vite | `vite build` | `vitest` | `eslint .` |
| vue-nuxt | `nuxt build` | `vitest` | `eslint .` |
| vue | `vite build` | `vitest` | `eslint .` |
| astro | `astro build` | `vitest` | `eslint .` |

**패키지 매니저 자동 감지** (Lock 파일 기준, `buildCommands` 미설정 시):

| Lock 파일 | 매니저 | 빌드 | 테스트 | 린트 |
|-----------|--------|------|--------|------|
| `bun.lockb` | bun | `bun run build` | `bun test` | `bun run lint` |
| `pnpm-lock.yaml` | pnpm | `pnpm build` | `pnpm test` | `pnpm lint` |
| `yarn.lock` | yarn | `yarn build` | `yarn test` | `yarn lint` |
| `package-lock.json` | npm | `npm run build` | `npm test` | `npm run lint` |

복수 Lock 파일 존재 시 위 우선순위(bun > pnpm > yarn > npm) 적용.

실패 시 수정 후 재실행, 3회 실패 시 사용자 보고.

### 5.5 의존성 취약점 검사 (선택)
빌드 성공 후, 도구 존재 시만 실행 (미설치 시 스킵). HIGH/CRITICAL 발견 → 경고 + PR body 포함. 빌드 차단 안 함.

### 6. 커밋 & 푸시
CLAUDE.md 워크트리 프로토콜 참조. push 전 develop 동기화 필수.
- 커밋: `feat: {taskId} Step {N} - {스텝 제목}`
- push 실패 시: pull --rebase → backlog.json 충돌은 서로 다른 Task 모두 유지, `metadata.version = max + 1` → 재시도 (최대 2회)

### 7. PR 생성
1. PR body 템플릿: 도메인 `.claude/domains/{domain}/templates/pr-body.md.tmpl` 우선 → 기본 템플릿 폴백
2. 마커 치환: `{{TASK_TITLE}}`, `{{STEP_NUMBER}}`, `{{STEP_TOTAL}}`, `{{CHANGES_LIST}}`
3. `gh pr create --base develop --title "feat: {taskId} Step {N} - {제목}" --body "{치환된 body}"`

### 8. 상태 업데이트
`skill-backlog` 쓰기 프로토콜 준수 (metadata.version +1, JSON 검증 필수).
step status → "pr_created", prNumber 기록. assignedAt 갱신 (lock heartbeat).

### 8.5 실행 로그
`.claude/state/execution-log.json`에 추가: action="pr_created", prNumber, stepNumber

### 9. 다음 스킬 호출 (프로필별)
- **standard**: `Skill tool: skill="skill-review-pr", args="{prNumber} --auto-fix"`
- **fast**: `Skill tool: skill="skill-merge-pr", args="{prNumber}"` (review 생략)
- 직접 리뷰/머지 금지. 반드시 Skill tool 사용.

### 10. 백그라운드 분석 (PR 생성 후 병렬)
| 분석 | 조건 | 서브에이전트 | timeout |
|------|------|-------------|---------|
| 문서 영향도 | 항상 | docs-impact-analyzer | 60초 |
| 테스트 품질 | agents.enabled에 "qa" 포함 | agent-qa | 60초 |

**에이전트 프롬프트 구성 (토큰 절감)**:
- 프롬프트에 포함: 변경 파일 목록, PR 번호, 브랜치명
- 프롬프트에 포함하지 않음: PR diff 전체, 소스 코드 전체 (에이전트가 필요 시 자체 Read)

각 Task `run_in_background: true`. 실패 시 "⚠️ 분석 불가" 출력 후 진행.

## --micro 옵션 (경량 경로)
소규모 작업(파일 ≤3개, ~100줄)을 plan 없이 바로 구현한다.

### Micro 워크플로우
1. **backlog 자동 등록**: type AI 추론(bug/chore/feature), priority AI 추론, steps=[{number:1, title:"Micro 구현", status:"pending"}], micro:true
2. **plan 생략**: 계획 파일 미생성, 사전 조건 면제
3. **코드 구현**: 일반 Step 3과 동일
4. **라인 수 검증 (Micro 전용)**:
   - ≤ 150줄: 정상
   - 150~300줄: 경고 "Micro 범위 초과. Standard 전환할까요?"
   - > 300줄: 차단 "Standard 경로 필요. /skill-plan 실행"
5. **빌드 & 테스트**: 일반과 동일
6. **커밋 & PR**: `{type}: {taskId} - {설명}` (type은 AI 추론)
7. **리뷰**: Trivial Fast Path 조건 매칭 시 경량 리뷰, 미매칭 시 일반 리뷰 폴백

자연어: "OO 고쳐줘" / "OO 버그 수정해줘" → 규모 추정 → Micro 판단 시 자동 전환. 확신 못 하면 Standard.

## --dry-run 옵션

빌드와 테스트가 통과하는지만 확인한다. PR을 생성하지 않는다.

1. **환경 준비**: 일반 플로우와 동일 (브랜치 생성/체크아웃)
2. **코드 구현**: 일반 Step 3과 동일
3. **빌드 & 테스트**: 일반 Step 5와 동일
4. **결과 출력**: 빌드/테스트/린트 결과 요약
5. **PR 미생성**: 커밋은 로컬에만 유지, push 안 함
6. **상태 미변경**: backlog.json step status 변경 안 함
7. **브랜치 유지**: 이후 `--retry`로 PR 포함 재실행 가능

> `--dry-run`은 `--micro`와 조합 가능: `/skill-impl --micro "OO" --dry-run`
> `--all`/`--next`와 조합 시 현재 스텝만 실행 (다음 스텝으로 진행하지 않음)

## --retry 옵션
실패한 현재 스텝을 처음부터 재시작한다. skill-impl 실패 시에만 사용 가능.
1. 현재 스텝의 `step.status` → `"pending"` 리셋
2. 기존 PR 처리: PR OPEN → close + 브랜치 삭제 / PR MERGED → 거부 ("이미 머지된 스텝은 retry 불가") / PR 없음 → 브랜치 삭제
3. `workflowState.currentSkill` → `"skill-impl"`, `fixLoopCount` → 0
4. 정상 플로우 재실행

## --skip 옵션
빌드 실패 스텝을 건너뛴다. 빌드 실패 상태에서만 사용 가능 (정상 흐름에서는 거부).
1. 경고: "Step {N}을 스킵합니다. 이후 스텝에서 빌드 실패가 발생할 수 있습니다."
2. 사용자 확인
3. `step.status` → `"skipped"`, `currentStep` +1
4. 다음 스텝 실행 또는 Task 완료 처리
- skill-report에서 "스킵된 스텝" 메트릭으로 집계

## --all 옵션
모든 스텝 연속 실행: impl → review-pr → merge-pr → impl --next (반복). skipped 스텝은 건너뜀.
중단 조건: CRITICAL auto-fix 실패, 빌드 3회 실패, 라인 수 초과

## lockedFiles 관리
- 스텝 시작: 계획 파일의 files → lockedFiles 추가 + assignedAt 갱신
- 파일 수정: 실제 수정 파일 감지 → lockedFiles/files 갱신
- 스텝 완료: lockedFiles 유지 (머지 전까지 보호)
- 장시간 작업: 코드 수정/커밋 시 assignedAt 자동 갱신. 동적 TTL은 skill-backlog 참조.

## 출력
필수 포함: Task ID, Step N/M, 변경 파일 수(생성/수정/삭제), 빌드/테스트/린트 결과, PR 링크, 백그라운드 분석 결과, 다음 자동 스킬, 남은 스텝 수

## 에러 복구
CLAUDE.md "에러 복구 프로토콜" 참조. 미존재 시 3회 재시도 후 사용자 보고.

## 주의사항
- 계획 파일 없이 구현 금지 (--micro/--retry/--skip 제외)
- 빌드/테스트 통과 필수
- 병렬 작업 시 파일 충돌 주의
