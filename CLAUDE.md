# candidate-web

## 프로젝트 개요

자사 채용 사이트 지원자 프론트엔드(Candidate Web). 이메일/소셜 회원가입, 채용 공고 조회, 지원서 작성·임시저장·제출, 마이페이지(전형 진행/철회)를 제공합니다. PII 암호화·OAuth2·멱등성 제출·SEO 최적화가 핵심 비기능 요구사항입니다.

### 기술 스택
- **Backend**: Node.js + TypeScript (Next.js Route Handlers / Server Actions)
- **Frontend**: Next.js 14 App Router (TypeScript, SSR/SSG)
- **Database**: PostgreSQL (Prisma 또는 Drizzle ORM)
- **Cache**: 인메모리 로컬 캐시 (Next.js `unstable_cache` / lru-cache)
- **Message Queue**: 없음 (필요 시 DB outbox 패턴 또는 BullMQ 도입)
- **Infrastructure**: docker-compose

### 도메인
- **유형**: 범용 (general)
- **컴플라이언스**: 개인정보보호법 (PII: 이름·연락처·생년월일·주소 — AES-256-GCM 컬럼 암호화 + 응답 마스킹), GDPR 잊혀질 권리(회원 탈퇴 익명화)

---

## 프레임워크 역할 경계

이 프로젝트는 **AI Crew Kit** 프레임워크 기반입니다.

| 프레임워크가 하는 것 | Claude가 하는 것 |
|---------------------|-----------------|
| 워크플로우 자동화 (plan→impl→review→merge) | 코드 작성 (모든 언어, 프로토콜, 패턴) |
| 품질 게이트 (빌드/테스트/리뷰 통과 필수) | 기술 판단 (아키텍처, 라이브러리 선택) |
| 팀 컨벤션 SSOT (코딩 스타일, 보안 규칙) | 도메인 지식 (프레임워크 문서에 없는 기술도 구현) |

**원칙**: 프레임워크는 "어떤 프로세스로 만드는지"를 관리하고, Claude는 "어떻게 짜는지"를 담당합니다. 프레임워크 컨벤션에 특정 기술 패턴이 없어도 Claude의 판단으로 구현을 진행합니다.

---

## 30초 요약 (Quick Reference)

### 매일 쓰는 4가지

| 하고 싶은 것 | 명령 |
|-------------|------|
| 다음 작업 시작 | "다음 작업 가져와줘" → `/skill-plan` → `/skill-impl` |
| 소규모 수정 | "OO 고쳐줘" → `/skill-impl --micro "설명"` |
| PR 리뷰 + 머지 | "PR 123 리뷰해줘" → 자동 체이닝 |
| 상태 확인 | "상태 확인해줘" → `/skill-status` |

### 3가지 주의사항
1. **계획 승인 전 코드 작성 금지** — plan → 승인 → impl 순서 필수
2. **빌드/테스트 통과 필수** — PR 생성 전 자동 검증
3. **자동 체이닝 중 멈추지 않음** — impl → review → merge 자동 진행

### 문제 발생 시
→ `.claude/docs/troubleshooting.md` 참조

---

## 세션 시작 시 필수

**SessionStart 훅이 자동 실행합니다. 수동 조작은 불필요합니다.**

훅 동작 요약:
1. `git sync` — 현재 브랜치 기준 최신 동기화 (워크트리/비워크트리 자동 구분)
2. 이전 세션 연속 계획(`.claude/state/continuation-plan.md`) 존재 시 내용 출력 → 남은 작업부터 자동 재개
3. 연속 계획이 없으면 일반 세션 시작 — 바로 작업 지시 가능

자주 쓰는 명령:

```bash
/skill-status   # 현재 상태 요약
/skill-plan     # 다음 작업 가져오기
```

<details>
<summary>훅이 미설치/비활성화/실패한 경우 (폴백 수동 절차)</summary>

다음 중 하나에 해당하면 아래 수동 절차를 따르세요:
- Claude Code 구버전으로 hooks 필드 미지원
- `.claude/state/hook-disabled.flag` 존재 (자동 비활성화 상태)
- `.claude/hooks/session-start.sh`가 없거나 실행되지 않음

```bash
# 1. 최신 상태 동기화
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  # Worktree 모드 (Claude Squad 등)
  git fetch origin develop
  git merge origin/develop
else
  git checkout develop
  git pull origin develop
fi

# 2. 이전 세션 연속 계획 확인
#    .claude/state/continuation-plan.md 존재 시 → 파일 읽고 남은 작업부터 자동 재개
#    존재하지 않으면 → 아래 3, 4번 진행

# 3. 상태 요약 보기
/skill-status

# 4. 다음 작업 가져오기
/skill-plan
```

자동 비활성화를 해제하려면 `rm .claude/state/hook-disabled.flag` 후 원인을 점검하세요. 자세한 내용은 `.claude/hooks/README.md` 참조.

</details>

---

## 상태 관리 (Git 기반 SSOT)

```
.claude/state/              # Git 관리
├── project.json            # 프로젝트 설정 (도메인, 스택, 에이전트)
├── backlog.json            # 백로그 + 상태 + Phase
└── completed.json          # 완료 이력

.claude/temp/               # 임시 파일 (Git 제외)
└── {taskId}-plan.md        # Task별 상세 계획
```

**Git clone/pull이 곧 동기화입니다.**

---

## 에이전트

| 에이전트 | 역할 | 호출 시점 |
|---------|------|----------|
| **pm** | 요구사항 정의, 백로그 관리 | `/skill-feature`, `/skill-backlog` |
| **planner** | 설계 분석, 스텝 분리 (skill-plan 서브에이전트) | `/skill-plan` |
| **backend** | Next.js Route Handler, API 설계, 비즈니스 로직 | `/skill-impl` |
| **frontend** | Next.js App Router UI, React 컴포넌트, 폼/상태 관리 | `/skill-impl` |
| **db-designer** | DB 스키마 분석, ERD 검증 (skill-plan 서브에이전트) | `/skill-plan` |
| **qa** | 테스트 품질 분석, 시나리오 도출 (skill-impl 서브에이전트) | `/skill-impl` |
| **code-reviewer** | 5관점(보안/도메인/테스트/문서/일반) 통합 PR 리뷰 | `/skill-review-pr` |
| **docs** | 문서 영향도 분석, 업데이트 초안 (skill-impl 서브에이전트) | `/skill-impl` |

> **비활성**: `devops` (운영 인프라 자동화 — 도입 시 `/skill-domain customize`로 활성)

---

## 주요 스킬 (프로파일: full)

| 스킬 | 용도 |
|------|------|
| `/skill-status` | 프로젝트 상태 / 진행 중 Task 요약 |
| `/skill-feature` | 신규 기능 요구사항 정의 → 백로그 등록 |
| `/skill-backlog` | 백로그 조회/추가/수정 |
| `/skill-plan` | Task 픽업 + 설계 분석 + 스텝 분리 |
| `/skill-impl` | 스텝별 구현 + PR 생성 |
| `/skill-review-pr` | PR 5관점 통합 리뷰 (자동 체이닝) |
| `/skill-fix` | CRITICAL 이슈 자동 수정 |
| `/skill-merge-pr` | PR Squash 머지 + 상태 갱신 |
| `/skill-hotfix` | main 긴급 수정 + 패치 릴리스 |
| `/skill-rollback` | git revert 기반 릴리스 롤백 |
| `/skill-retro` | 완료 Task 회고 |
| `/skill-report` | throughput/quality/code/health 4축 리포트 |
| `/skill-health-check` | 코드베이스 건강 검진 |
| `/skill-estimate` | 작업 복잡도 추정 |
| `/skill-docs` | 도메인별 참고자료 조회 |
| `/skill-create` | 커스텀 스킬 스캐폴딩 |
| `/skill-domain` | 도메인 조회/전환/커스터마이징 |

---

## 자연어 명령어

| 자연어 | 매핑 스킬 |
|--------|----------|
| "다음 작업 가져와줘" / "계획 세워줘" | `/skill-plan` |
| "개발 진행해줘" / "구현해줘" | `/skill-impl` |
| "다음 스텝 진행해줘" | `/skill-impl --next` |
| "PR {N} 리뷰해줘" | `/skill-review-pr {N}` |
| "PR {N} 머지해줘" | `/skill-merge-pr {N}` |
| "긴급 수정해줘: {설명}" | `/skill-hotfix` |
| "v{x.y.z} 롤백해줘" | `/skill-rollback` |
| "상태 확인해줘" | `/skill-status` |
| "회고 해줘" | `/skill-retro` |
| "헬스체크 해줘" | `/skill-health-check` |

> 도메인이 `general`이므로 별도 도메인 docs/checklists 자동 매핑은 없습니다. 필요 시 `.claude/domains/general/`에 추가하거나 `/skill-domain switch`로 전환하세요.

---

## 자동 연속 실행 규칙 (필수)

**현재 프로필: standard**

스킬 완료 후 조건 충족 시 **반드시** 다음 스킬을 자동 호출한다. 멈추거나 질문하지 않는다.

| 트리거 | 자동 호출 |
|--------|----------|
| skill-feature 승인 완료 | `/skill-plan` |
| skill-plan 설계 승인 완료 | `/skill-impl` |
| skill-impl Step 완료 + PR 생성 | `/skill-review-pr {N}` |
| skill-review-pr APPROVED | `/skill-merge-pr {N}` |
| skill-review-pr CRITICAL 발견 (≤2회) | `/skill-fix` → `/skill-review-pr` 재실행 |
| skill-merge-pr 완료 + 다음 스텝 존재 | `/skill-impl --next` |
| skill-merge-pr 완료 + 마지막 스텝 | Task 완료 처리 + `/skill-retro` 제안 |

### --all 옵션
`/skill-impl --all` 사용 시 모든 스텝을 사용자 개입 없이 연속 실행.

### 루프 가드
- skill-fix → skill-review-pr 루프: **최대 2회**
  - 1회: skill-review-pr → CRITICAL → skill-fix → skill-review-pr (재리뷰)
  - 2회: 재리뷰 → CRITICAL → skill-fix → skill-review-pr (최종 리뷰)
  - 3회째 CRITICAL 발견 시: REQUEST_CHANGES 출력 후 **즉시 중단** (수동 개입 필요)
- 카운트 기준: 같은 PR에 대한 skill-fix 호출 횟수

### 중단 조건 (이 경우에만 멈추고 사용자에게 보고)
- CRITICAL 이슈 auto-fix 실패
- 빌드 실패 (3회 재시도 후)
- 라인 수 제한 초과 (프로필별 상이)
- skill-fix → skill-review-pr 루프 2회 초과 (루프 가드 발동)

### 금지 사항
- 자동 호출 대상인데 "진행할까요?" 질문하며 멈추기 **금지**
- Skill tool 없이 직접 실행 **금지** (반드시 `Skill tool` 사용)
- 에러/REQUEST_CHANGES 외 상황에서 멈추기 **금지**

---

## 워크플로우 진행 표시 프로토콜 (필수)

### 스킬 진입 시 진행바 출력

체이닝 관련 스킬(plan, impl, review-pr, fix, merge-pr, feature) 진입 시:
1. backlog.json에서 현재 Task의 `workflowState`와 `steps` 읽기
2. 다음 포맷으로 진행바 출력:

```
━━━ {TASK_ID} "{TASK_TITLE}" ━━━━━━━━━━━
 ✅ plan → ✅ impl(1/N) → 🔄 review → ⬜ merge → ⬜ impl(2/N)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 📍 현재: {현재 스킬 설명} (Step N — {스텝 제목})
```

### 아이콘 규칙
- ✅ 완료된 단계
- 🔄 현재 진행 중
- ⬜ 미진행
- ⏭️ 자동 체이닝 전환
- ⛔ 워크플로우 중단

### 단계별 설명 템플릿
- plan: "설계 분석 및 스텝 분리 중"
- impl: "코드 구현 중 (Step N — {스텝 제목})"
- review-pr: "코드 리뷰 중 (보안/도메인/테스트 3관점)" (standard에서만 실행)
- fix: "CRITICAL 이슈 자동 수정 중 (회차: N/2)" (standard에서만 실행)
- merge-pr: "PR 머지 및 상태 업데이트 중"
- feature: "새 워크플로우 시작"

### 자동 체이닝 전환 출력

스킬 간 자동 체이닝 전환 시 다음 포맷으로 출력:

```
━━━ ⏭️ 자동 체이닝 ━━━━━━━━━━━━━━━━━
 {source_skill} 완료 → {target_skill} 자동 시작
 사유: {체이닝 사유 설명}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| 전환 | 사유 메시지 |
|------|-----------|
| feature → plan | "요구사항 승인 완료, 설계 분석 진행" |
| plan → impl | "설계 승인 완료, 코드 구현 진행" |
| impl → review-pr | "PR #{N} 생성 완료, 자동 리뷰 진행" |
| review-pr → fix | "CRITICAL 이슈 {N}건 발견, 자동 수정 진행" |
| review-pr → merge-pr | "APPROVED, PR 머지 진행" |
| merge-pr → impl --next | "Step {N} 머지 완료, 다음 스텝 진행" |

### 워크플로우 중단 출력

중단 조건 발생 시 다음 포맷으로 출력:

```
━━━ ⛔ 워크플로우 중단 ━━━━━━━━━━━━━━
 사유: {중단 사유}
 상태: {현재 상태 상세}
 다음: {사용자 조치 안내}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| 중단 사유 | 상태 | 다음 조치 |
|----------|------|----------|
| CRITICAL 2회 재발견 | "PR #{N}에 REQUEST_CHANGES" | "수동으로 CRITICAL 이슈 수정 후 /skill-review-pr {N}" |
| 빌드 3회 실패 | "빌드 실패 (시도 3/3)" | "빌드 오류 해결 후 /skill-impl --next" |
| 라인 수 700 초과 | "변경 {N}줄 (700줄 제한 초과)" | "스텝 재분리 필요, /skill-plan으로 재설계" |

---

## 워크플로우 상태 추적 프로토콜 (필수)

체이닝 스킬(plan, impl, review-pr, fix, merge-pr, feature) 진입/완료 시 해당 Task의 `workflowState`를 업데이트한다:

**진입 시:**
```json
"workflowState": {
  "currentSkill": "{현재 스킬명}",
  "lastCompletedSkill": "{이전 스킬명}",
  "prNumber": "{PR 번호 또는 null}",
  "fixLoopCount": "{N, skill-fix 전용, 루프 가드용}",
  "autoChainArgs": "{체이닝 인자}",
  "updatedAt": "{현재 ISO 8601}"
}
```

**완료 시:** `currentSkill`을 다음 스킬로, `lastCompletedSkill`을 현재 스킬로 갱신.
**Task 완료 시:** `workflowState: null`로 초기화.

---

## 에러 복구 프로토콜 (필수)

스킬 실행 중 에러 발생 시, 반드시 아래 형식으로 안내한다:

```
❌ [{에러 유형}]: {구체적 원인}

📋 현재 상태:
   - Task: {TASK-ID} Step {N}/{M}
   - 브랜치: {현재 브랜치}
   - 마지막 성공 지점: {단계명}

🔧 복구 방법:
   1. [권장] {가장 안전한 방법}
   2. {대안 방법}
   3. [최후수단] {리셋 방법}
```

자동 복구 가능한 에러는 자동 시도 후 결과를 보고한다.
자동 복구 불가 시 복구 방법을 제시하고 사용자 선택을 대기한다.

| 에러 유형 | 자동 복구 | 수동 복구 |
|----------|----------|----------|
| 빌드 실패 (1-2회) | 자동 재시도 | - |
| 빌드 실패 (3회) | - | [권장] 에러 로그 확인 후 수정 / `--retry` / [최후수단] `--skip` |
| JSON 파싱 에러 | `git checkout` 복원 | [권장] 자동 복원 수락 / 수동 수정 |
| Git push 충돌 | `pull --rebase` 시도 | [권장] 자동 rebase 수락 / 충돌 수동 해결 |
| PR 생성 실패 | 원인별 분기 | [권장] `gh auth status` 확인 / 재시도 |
| gh auth 만료 | `gh auth refresh` 안내 | [권장] `! gh auth refresh` 실행 |
| 세션 끊김 | intent 기반 복구 제안 | [권장] `/skill-status` 후 안내 / 수동 상태 초기화 |
| lock TTL 만료 | 자동 연장 제안 | [권장] 연장 수락 / `--extend-lock` / [최후수단] `unlock --force` |
| 컨텍스트 압축 | workflowState 복원 | [권장] `/skill-status` → 맥락 복원 |
| subagent 타임아웃 | 스킵 후 진행 | [권장] 결과 없이 진행 수락 / 수동 재실행 |

> 📖 **상세 에러 가이드**: `.claude/docs/troubleshooting.md` 참조

---

## 컨텍스트 압축(compact) 관리

### 기본 원칙
컨텍스트 압축(compact)은 자연 현상이다. **작업을 중단하지 않고 계속 진행한다.**

### compact 후 복구 절차
시스템이 컨텍스트를 압축하면, 이전 대화의 세부 내용이 축약된다. 현재 진행 중인 작업에 필요한 파일만 재읽기한다:
- **항상**: `.claude/state/backlog.json` — 현재 Task, step 상태, workflowState (핵심 상태)
- **impl/review/merge 중일 때만**: `.claude/temp/{taskId}-plan.md` — 계획 상세
- **빌드/설정 필요 시만**: `.claude/state/project.json` — 도메인, 빌드 명령

### 새 세션 시작 시
`.claude/temp/continuation-plan.md` 존재 시 → 읽고 남은 작업부터 자동 재개 → 완료 후 삭제

---

## 스킬 진입 시 경량 점검 프로토콜 (필수)

체이닝 관련 스킬(plan, impl, review-pr, merge-pr) 진입 시, MUST-EXECUTE-FIRST 완료 후 워크플로우 진행 표시 전에 현재 Task에 대해 다음 3가지를 빠르게 확인한다.

### 1. PR-backlog 상태 일치 확인

**조건**: step.prNumber가 있고 step.status == "pr_created"

**동작**:
1. `gh pr view {prNumber} --json state,mergedAt` 실행
2. 상태에 따라 backlog.json 자동 보정:

| GitHub PR state | backlog step.status 변경 | 추가 동작 |
|----------------|------------------------|----------|
| MERGED | pr_created → done | step.mergedAt 갱신, currentStep 증가 |
| CLOSED | pr_created → pending | prNumber 제거 |
| OPEN | 변경 없음 | 정상 상태로 판단 |

3. 자동 보정 시 다음 포맷으로 출력:
```
━━━ 🔧 자동 복구 수행 ━━━━━━━━━━━━━━━━
 감지: PR #{N}가 GitHub에서 이미 머지됨
 조치: {TASK_ID} Step {N} 상태를 pr_created → done으로 갱신
 결과: Step {N+1}부터 정상 진행 가능
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

⚠️ 네트워크 실패 시 이 점검을 스킵한다 (경고로 처리, 에러 아님):
```
⚠️ PR 상태 확인 불가 (GitHub API 연결 실패)
   점검 스킵, 정상 진행합니다.
```

### 2. Stale workflow 감지

**조건**: workflowState.updatedAt < now() - 30분 && status == "in_progress"

**동작**:
1. 현재 상태 표시:
```
━━━ ⚠️ Stale 워크플로우 감지 ━━━━━━━━━━
 Task: {TASK_ID} "{TASK_TITLE}"
 마지막 갱신: {N}시간 전 ({lastCompletedSkill} 단계)
 현재 PR: #{N} ({open/merged/closed})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
2. AskUserQuestion으로 선택지 제공:

| 선택지 | 후처리 |
|-------|-------|
| "이전 작업 이어서 진행" | workflowState.updatedAt 갱신 → 현재 스킬 재개 |
| "처음부터 다시" | workflowState 초기화 → plan부터 재시작 |
| "다른 Task 선택" | 현재 Task lock 해제 → Task 선택 화면 |

### 3. Intent 파일 복구

**조건**: `.claude/temp/{taskId}-complete-intent.json` 존재

**동작**:
1. intent 파일 읽기
2. 미완료 작업 자동 실행 (skill-merge-pr의 "Intent 기반 복구" 절차)
3. intent 파일 삭제
4. 복구 결과 알림:
```
🔄 이전 세션의 미완료 처리를 복구했습니다: {taskId}
   복구 항목: {pending 목록}
```

---

## 워크플로우

### 새 기능 (기획부터)

```
/skill-feature "기능명"
  ↓
요구사항 정의 -> docs/requirements/CANDID-XXX-spec.md
  ↓
사용자 검토/승인
  ↓
backlog.json에 Task 등록
  ↓
/skill-plan으로 설계 + 계획 수립
```

### 기존 Task 개발

```
/skill-plan
  ↓
Task 선택 -> 요구사항 확인 -> 설계 -> 스텝 분리 계획
  ↓
(사용자 설계/계획 검토)
  ↓
/skill-impl 또는 "개발 진행해줘"
  ↓
Step 1 개발 -> PR 자동 생성
  ↓
/skill-review-pr {번호} 또는 "PR {번호} 리뷰해줘"
  ↓
(수정 필요 시 수정 -> 커밋 -> 푸시)
  ↓
/skill-merge-pr {번호} 또는 "PR {번호} 머지해줘"
  ↓
/skill-impl --next 또는 "다음 스텝 진행해줘"
  ↓
(반복)
  ↓
마지막 스텝 머지 -> 전체 완료
```

### 긴급 수정 워크플로우

```
"긴급 수정해줘: {설명}" 또는 "v1.2.3 롤백해줘"
        │
        ├── [수정] /skill-hotfix
        │     ├── main에서 hotfix 브랜치 분기
        │     ├── 코드 수정 + 빌드/테스트
        │     ├── PR 생성 (--base main) + 보안 리뷰
        │     ├── 머지 → 패치 버전 범프 → 태그
        │     └── develop 백머지
        │
        └── [롤백] /skill-rollback
              ├── main에서 revert 브랜치 분기
              ├── git revert (히스토리 보존)
              ├── Revert PR 생성 (--base main)
              ├── 머지 → 패치 버전 범프 → 태그
              └── develop 백머지
```

---

## Git 브랜치 전략

### 브랜치 구조
```
main (운영)
  ├── hotfix/HOT-NNN-긴급수정 (main에서 분기 → main PR)
  ├── revert/{대상} (main에서 분기 → main PR)
  └── develop (개발 통합)
        ├── feature/CANDID-XXX-stepN (스텝별 개발)
        └── bugfix/CANDID-XXX-버그명 (버그 수정)
```

### PR 규칙
- PR은 develop 브랜치로 생성
- 리뷰 승인 후 Squash 머지
- **스텝별 PR 생성** (500라인 미만 단위)
- PR 생성: `/skill-impl` 스텝 완료 시 자동 처리
- PR 리뷰: `/skill-review-pr {번호}`
- PR 머지: `/skill-merge-pr {번호}`

### 커밋 메시지 규칙
```
<type>: <description>

Types:
- feat: 새 기능
- fix: 버그 수정
- refactor: 리팩토링
- docs: 문서
- test: 테스트
- chore: 기타

예: feat: CANDID-010 Step 1 - 서비스 구현
```

---

## Git 워크트리 프로토콜

워크트리 감지: `git rev-parse --git-dir` ≠ `git rev-parse --git-common-dir`

지원 오케스트레이터 (모두 동일한 분기 로직 사용):

| 오케스트레이터 | 진입 방법 | 워크트리 경로 | 브랜치 |
|--------------|---------|-------------|--------|
| **Claude Code 네이티브** (v2.1.49+) | `claude --worktree <name>` 또는 `-w <name>` | `.claude/worktrees/<name>/` | `worktree-<name>` |
| **Claude Squad** | `cs new` 등 외부 도구 | 외부 도구 결정 | 외부 도구 결정 |
| **수동 worktree** | `git worktree add ...` | 사용자 지정 | 사용자 지정 |

> 네이티브 worktree 사용 시 `.claude/worktrees/`는 `.gitignore`로 추적 제외되어야 한다 (상태 파일 경합 방지).

| 작업 | 일반 모드 | 워크트리 모드 |
|------|----------|-------------|
| develop 동기화 | `git checkout develop && git pull` | `git fetch origin develop && git merge origin/develop` |
| push | `git push origin develop` | `git push -u origin HEAD` |
| PR merge | `gh pr merge --squash --delete-branch` | `gh pr merge --squash` (NEVER --delete-branch) |
| 머지 후 동기화 | `git checkout develop && git pull --prune` | `git fetch origin develop --prune && git merge origin/develop` |
| 상태 파일 반영 | develop에 직접 커밋 | **fetch+merge 먼저** → 워크트리 커밋 → push → 메인 리포에 cp → 커밋 → push |
| 브랜치 생성 | `git checkout -b feature/...` | 불필요 (현재 워크트리 브랜치 직접 사용) |
| merge 후 step 재검증 | 불필요 | backlog.json 재읽기 → step이 done/merged면 다음 step 스킵 |

---

## Task 개발 규칙

### 작업 ID 체계
```
CANDID-{번호}

예: CANDID-001, CANDID-010
```

### 스텝 분리 기준
- 기본 제한: **500라인 미만** (스텝별 자동 조정: 50~1000)
- skill-plan이 스텝 특성에 따라 prLineLimit을 자동 설정 (사용자 수동 설정 불필요)

### 라인 수 제한

**제한값 결정**: step.prLineLimit > conventions.prLineLimit > 500 (폴백 체인)

| 프로필 | 진행 | 경고 | 강력 경고 | 차단 |
|--------|------|------|----------|------|
| standard | <limit×0.6 | limit×0.6~limit | limit~limit×1.4 | >limit×1.4 |
| fast | <limit | limit~min(limit×2,1000) | — | >min(limit×2,1000) |

---

## 코딩 컨벤션

### TypeScript / Next.js
- TypeScript **strict** 모드 강제. `any`/`unknown` 사용 시 주석으로 사유 명시.
- Server Components 기본, Client Component는 `'use client'` 명시 + 최소화.
- Route Handlers(`app/api/.../route.ts`) — REST 메서드는 export named function(`GET`, `POST`, ...).
- 환경 변수는 `zod` 스키마로 단일 진입점에서 검증.
- 에러 응답은 표준 포맷(`{timestamp, status, code, message, path, traceId, details}`) — `code`는 `lib/errors/codes.ts` `ERROR_CATALOG`의 `ErrorCode`만 사용.
- Route Handler는 `withErrorHandler`(`@/lib/errors`)로 감싸고 실패 시 `AppError`를 throw한다 — 전역 핸들러가 표준 에러 응답으로 변환. 핸들러에서 응답 포맷 수동 조립 금지.

### 보안 강제 사항 (PR 리뷰 CRITICAL)
- 비밀번호는 **BCrypt strength 12** 외 어떤 형태로도 저장/로깅 금지.
- JWT 시크릿/DB 비밀번호 등은 `.env` + `zod`로 주입. 코드/응답/로그 노출 금지.
- PII(`phone`, `birth_date`)는 AES-256-GCM 컬럼 암호화 + 응답 마스킹.
- User PII write는 `encryptUserPiiInput` 의무. `$queryRaw`/`$executeRaw` 우회 시(ESLint 차단 — `no-restricted-syntax`) `decryptUserPiiField`/`encryptPiiWithVersion`을 직접 호출.
- 사용자 입력 HTML은 DOMPurify 화이트리스트 sanitize. 저장 + 출력 시 이중 방어.
- 외부 URL fetch(OG 미리보기 등) 시 SSRF 차단: 내부망 IP(10./172.16-31./192.168./127./169.254.) 거부, 3초 타임아웃, 1MB 응답 제한.
- 멱등성 키(`Idempotency-Key`)로 지원서 제출 중복 방지 — 24시간 보존.

### DB
- 모든 마이그레이션은 Prisma migrate 또는 Drizzle migrate. 수동 ALTER 금지.
- `UNIQUE(user_id, job_posting_id)` (활성 지원서) — 부분 인덱스 활용.
- 낙관적 락(`version` 컬럼) — `application_drafts`에 적용.
- 외래키는 RESTRICT 기본, 카스케이드는 명시적 결정.

### Lint / 포맷
- ESLint + Prettier — pre-commit에서 자동 강제.
- 파일 경로 alias(`@/`) 권장. 상대 경로 3단계 이상 금지.

---

## 에러 코드 체계

| 도메인 | 접두어 | 예시 |
|--------|--------|------|
| 인증 | `AUTH_` | `AUTH_INVALID_CREDENTIALS`, `AUTH_ACCOUNT_LOCKED`, `AUTH_EMAIL_NOT_VERIFIED`, `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`, `AUTH_REFRESH_INVALID`, `AUTH_REFRESH_EXPIRED`, `AUTH_FORBIDDEN` |
| 사용자 | `USER_` | `USER_EMAIL_DUPLICATED`, `USER_NOT_FOUND` |
| 공고 | `JOB_` | `JOB_NOT_FOUND`, `JOB_NOT_OPEN`, `JOB_CLOSED` |
| 지원 | `APP_` | `APP_NOT_FOUND`, `APP_INVALID_STAGE_TRANSITION`, `APP_ALREADY_SUBMITTED`, `APP_DEADLINE_PASSED`, `APP_DRAFT_CONFLICT` |
| 파일 | `FILE_` | `FILE_SIZE_EXCEEDED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_UPLOAD_FAILED` |
| 시스템 | `SYS_` | `SYS_INTERNAL_ERROR`, `SYS_DEPENDENCY_UNAVAILABLE`, `SYS_VALIDATION_FAILED` |

> `code`는 클라이언트가 분기 처리할 수 있도록 **불변 문자열 상수**로 정의. 운영 환경 응답에 스택 트레이스 미노출.
> 에러 코드 **SSOT는 `lib/errors/codes.ts`의 `ERROR_CATALOG`** — 신규 코드는 카탈로그를 먼저 갱신한다. 위 표는 예시다.

---

## 테스트 규칙

### 커버리지 목표
- 단위 테스트: 80%+
- 통합 테스트: 주요 플로우 100%

---

## 산출물 저장 위치

```
docs/
├── requirements/         # 요구사항 문서
├── api-specs/            # API 명세 (OpenAPI)
├── architecture/         # 아키텍처 문서
├── security/             # 보안 문서
├── test-plans/           # 테스트 계획
├── retro/                # 회고 리포트
└── reports/              # 메트릭 리포트
```

---

<!-- CUSTOM_SECTION_START -->

## 프로젝트 고유 컨텍스트

### 비즈니스 요구사항 출처
- 상세 PRD: `docs/sample-requirement.md` (US-AUTH, US-JOB, US-APP, US-MY)
- 단계별 우선순위: P0(MVP) → P1(런칭) → P2(런칭 후)
- 미결 정책 결정 사항: PRD §8 — 휴대폰 본인 인증, 회원 탈퇴 정책, 소셜 자동 연결, 면접관 이름 노출 등은 의사결정자 검토 필요

### 핵심 비즈니스 규칙 (BR — PR 리뷰 시 검증 대상)
- **BR-APP-01**: 동일 사용자 × 동일 공고 활성 지원서(`result != WITHDRAWN`)는 1건만 — DB 제약 + 트랜잭션 검증
- **BR-APP-03/04**: 제출 시점 `closes_at < now`는 422 — *작성 중 마감되는 경우 방어*
- **BR-APP-05**: `application_number` = `A-YYYYMM-NNNNN` 형식 발급
- **BR-APP-06**: 멱등성 키 24시간 동일 응답
- **BR-AUTH-03**: 로그인 5회 실패 → 15분 잠금. 성공 시 카운터 초기화
- **BR-AUTH-04**: 이메일 미인증 사용자 — 로그인/조회는 가능, **지원서 제출 시점**에만 차단
- **BR-FILE-01**: 확장자 + MIME 이중 검증. UUID 재명명
- **BR-PII-01**: PII 컬럼 AES-256-GCM. 응답 마스킹
- **BR-PII-03**: 회원 탈퇴 — 진행 중 지원 있으면 익명화·보존, 없으면 즉시 삭제. 채용 종료 후 1년 자동 파기
- **BR-APP-07**: 전형 단계 전이는 허용 그래프로만 진행(점프/역행 금지). `HIRED`/`REJECTED` 종단, `WITHDRAWN`은 전이 불가. 상태+이력+감사 단일 트랜잭션 + `FOR UPDATE` 직렬화. 결과 파생: `HIRED→PASSED`, `REJECTED→FAILED` (CANDID-053)
- **BR-TX-01**: 지원서 제출 = Application 생성 + Draft 삭제 + 이력 생성 단일 트랜잭션
- **BR-TX-02**: 외부 호출(이메일/Slack)은 트랜잭션 *외부*에서 이벤트 발행 후 비동기 처리

### NFR 목표
- 응답 시간: 공고 목록/상세 P95 < 300ms, 지원서 제출 P95 < 800ms
- 동시 사용자: 일반 1k DAU, 채용 시즌 피크 10k
- 가용성: 99.5%
- 접근성: WCAG 2.1 AA
- SEO: 공고 페이지 SSR/SSG + JobPosting schema.org structured data

### Phase 진행 가이드
| Phase | 범위 | 우선순위 |
|-------|------|---------|
| **PHASE-1** (기반/인프라) | DB 스키마, 인증, PII 암호화, 보안 가드 | P0 — 먼저 통과해야 PHASE-2 진입 가능 |
| **PHASE-2** (핵심 도메인) | 회원가입/로그인/공고/지원서 작성·제출/마이페이지 | P0 — MVP 완성 단계 |
| **PHASE-3** (부가 기능) | 비밀번호 재설정, 탈퇴/철회/프로필, SEO | P1 — 런칭 필수 |
| **PHASE-4** (운영/품질) | 감사 로그, 메트릭, 접근성, 배치 | P2 — 런칭 후 개선 |

<!-- CUSTOM_SECTION_END -->
