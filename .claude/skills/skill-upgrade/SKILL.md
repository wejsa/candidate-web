---
name: skill-upgrade
description: 프레임워크 업그레이드 - ai-crew-kit 최신 버전으로 프레임워크 파일 업데이트. /skill-upgrade로 호출합니다.
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(cp:*), Bash(rm:*), Bash(tar:*), Bash(diff:*), Bash(mktemp:*), Bash(mkdir:*), Bash(cat:*), Bash(ls:*), Bash(date:*), Bash(wc:*), Bash(df:*), Bash(jq:*), Bash(echo:*), Read, Write, Edit, Glob, Grep, AskUserQuestion
argument-hint: "[--dry-run] [--source <git-url|local-path>] [--version <tag>] [--rollback <backup-path>]"
complexity-hint: light
---

# skill-upgrade: 프레임워크 업그레이드

## 실행 조건
- 사용자가 `/skill-upgrade` 또는 "프레임워크 업그레이드해줘" 요청 시

## 옵션
```
/skill-upgrade                              # 최신 버전으로 업그레이드
/skill-upgrade --dry-run                    # 변경 사항 미리보기 (실제 변경 없음)
/skill-upgrade --source <git-url|local-path> # 소스 지정
/skill-upgrade --version <tag>               # 특정 버전으로 업그레이드
/skill-upgrade --rollback                    # 가장 최근 백업에서 롤백
/skill-upgrade --rollback <backup-path>      # 지정 백업에서 롤백
```

## 롤백 모드

`--rollback` 옵션 감지 시, 아래 플로우만 실행하고 종료:

1. 백업 경로 결정: `--rollback <path>` → 해당 경로, 경로 없음 → `.claude/temp/upgrade-backup-*/` 중 최신
2. 백업 디렉토리 존재 및 무결성 확인
3. 사용자 확인: "다음 백업에서 롤백합니다: {경로}. 진행하시겠습니까?"
4. `backup.tar.gz` 해제 → 프레임워크 파일 복원
5. `project.json`의 `kitVersion`을 백업 시점 값으로 되돌림
6. 롤백 완료 리포트 출력

## 실행 플로우

### Step 1: 환경 검증

| 항목 | 조건 | 처리 |
|------|------|------|
| project.json | 없음 | "/skill-init 먼저 실행" 안내 후 종료 |
| Git 상태 | uncommitted changes | 경고 + 진행 여부 질문 |
| 잠금 파일 | `.upgrade.lock` 존재 | "이전 업그레이드 중단됨" 경고 + 롤백 안내 |
| 디스크 공간 | 부족 | 경고 후 종료 |

확인 대상: `project.json`, `git status --porcelain`, `.claude/temp/.upgrade.lock`, `df -h .`

### Step 2: 소스 확보

소스 결정 우선순위: `--source` 옵션 → `project.json`의 `kitSource` → 기본값 `https://github.com/wejsa/ai-crew-kit.git`

- Git URL → `git clone --depth 1 [--branch <tag>]` 임시 디렉토리에
- 로컬 경로 → 직접 사용
- `--version` 옵션 → `--branch <tag>`로 특정 버전 클론

### Step 3: 소스 구조 검증

필수 디렉토리/파일 확인: `skills/`, `domains/`, `templates/`, `schemas/`, `VERSION`
하나라도 없으면 "유효한 AI Crew Kit 소스가 아닙니다" 안내 후 종료.

### Step 4: 버전 비교

| 비교 결과 | 동작 |
|-----------|------|
| 새 버전 > 현재 | 정상 진행 |
| 새 버전 = 현재 | "이미 최신 버전" + 진행 여부 질문 |
| 새 버전 < 현재 | "다운그레이드" 경고 |
| 현재 = unknown | 부트스트랩 모드 — 정상 진행 |

### Step 5: 스키마 마이그레이션 체크

`migrations.json` 확인 → 있으면 현재 kitVersion 해당 마이그레이션 항목 확인, 없으면 스키마 diff 폴백.

### Step 6: 커스터마이징 감지

**6-0. SHA256 해시 비교 (전체 프레임워크 파일)**

전체 프레임워크 디렉토리(`agents`, `skills`, `domains`, `templates`, `schemas`, `workflows`, `docs`)의 모든 파일에 대해 SHA256 해시 비교:
- 동일 경로에 존재하나 해시 불일치 → 사용자 수정 파일로 감지
- 감지된 파일은 미리보기에 포함 (파일명, 현재 해시 앞 8자, 소스 해시 앞 8자)
- 덮어쓰기 전 사용자에게 확인 (AskUserQuestion): "소스로 덮어쓰기" / "현재 유지" / "수동 머지"

**6-1. 도메인 커스텀 파일 감지**: 현재에만 존재하는 파일 = 사용자 추가 커스텀 파일
**6-2. domain.json 커스텀 항목 감지**: 사용자 추가 `keywords`, `checklists` 항목 추출
**6-3. settings.json 커스텀 권한 감지**: 현재에만 있는 `allow[]` 항목 = 커스텀 권한

### Step 7: 변경 미리보기 (diff)

필수 포함: 버전 전환(v{current} → v{new}), 디렉토리별 추가/수정/삭제 수, 보존 커스터마이징 요약, 해시 불일치 파일 목록, 스키마 마이그레이션 항목

### Step 8: 사용자 확인

- `--dry-run`: 미리보기만 출력 후 **종료**
- 일반: AskUserQuestion으로 진행 여부 확인

### Step 9: 백업 생성

백업 디렉토리: `.claude/temp/upgrade-backup-{YYYYMMDD-HHmmss}/`
- 프레임워크 디렉토리 + settings.json + CLAUDE.md + README.md → `backup.tar.gz`
- `tar tzf`로 무결성 검증
- 현재 kitVersion을 `kitVersion.txt`에 기록

### Step 10: 커스텀 콘텐츠 추출

**10-0. CUSTOM_SECTION 마커 안전장치**
- CLAUDE.md/README.md에서 `CUSTOM_SECTION_START` 마커 존재 확인
- 마커 없으면: 전체 파일 백업 + 템플릿 diff로 커스텀 내용 추출 + 경고 출력

**10-1~10-5**: CLAUDE.md/README.md 커스텀 섹션, 도메인 커스텀 파일, domain.json 커스텀 항목, settings.json 커스텀 권한 — 각각 임시 저장

### Step 11: 프레임워크 파일 교체

- 잠금 파일 + 진행 상태 파일 생성
- 커스텀 스킬 디렉토리(`.claude/skills/custom`) 별도 백업
- 프레임워크 디렉토리 삭제 → 새 소스에서 복사 (디렉토리 단위)
- 커스텀 스킬 복원
- **실패 시 자동 롤백**: `tar xzf "$BACKUP_DIR/backup.tar.gz"` + 잠금 파일 삭제

### Step 12: 커스터마이징 복원 + project.json 마이그레이션

- 12-1. 도메인 커스텀 파일 원위치 복원
- 12-2. domain.json 커스텀 항목 머지 (중복 키는 사용자 값 우선)
- 12-3. settings.json 머지: allow 합집합(중복 제거) + 기존 deny 보존
- 12-4. project.json: kitVersion 업데이트, kitSource 설정, migrations 적용
- 12-5. 프로젝트 파일 마이그레이션 (migrations.json의 `add_gitignore_entry` 타입):
  - 대상 entry가 `.gitignore`에 없으면 주석(`comment`)과 함께 추가
  - `git ls-files --error-unmatch <entry>` 검사 → 이미 추적 중인 파일 감지 시 `trackedWarning` 메시지 출력 (자동 제거하지 않고 사용자 안내만)
  - 이미 존재하면 no-op

### Step 13: CLAUDE.md/README.md 재생성

> ⚠️ **서브 에이전트 위임 금지** — 메인 에이전트가 직접 수행한다. 서브 에이전트는 템플릿 변경 맥락이 없어 구 버전을 복사할 위험이 있다.

**13-0. CUSTOM_SECTION 확인**: Step 10에서 임시 저장한 CUSTOM_SECTION 내용을 사용한다 (이 시점에서 기존 CLAUDE.md를 다시 읽지 않는다)

**13-1. 결정적 치환 (CLAUDE.md)**:
1. **새 템플릿**(`templates/CLAUDE.md.tmpl`) 전체를 Read로 로드
2. 마커(`{{...}}`)를 Layered Override 값으로 문자열 치환
3. `{{CUSTOM_SECTION}}`에 13-0에서 추출한 내용 삽입
4. 치환 완료된 전체 내용을 Write로 CLAUDE.md에 기록
5. ❌ **이전 CLAUDE.md를 참조하지 않는다** — CUSTOM_SECTION 외의 내용은 오직 템플릿에서만 생성

**13-2. 결정적 치환 (README.md)**: 동일 패턴

**13-3. 재생성 검증**:
1. 새 템플릿에서 비-마커 고유 문장 3개를 샘플 추출
2. 재생성된 CLAUDE.md에서 해당 문장 존재 확인 (Grep)
3. 구 템플릿에만 있던 삭제 대상 키워드가 잔존하는지 네거티브 체크 (`CUSTOM_SECTION` 내부 제외)
4. 불일치 시 → 13-1부터 재시도 (최대 1회)

### Step 14: 완료 처리

잠금 파일 삭제, 진행 상태 파일 삭제, 임시 클론 디렉토리 정리

### Step 15: 프레임워크 검증

`Skill tool: skill="skill-validate"` 자동 호출.
- 통과 → "✅ 검증 통과", 실패 → 경고 + `--fix` 안내 (롤백하지 않음)

### Step 15.5: 신규 기능 안내

`migrations.json`의 `features` 배열에서 **이전 버전 < feature.version ≤ 새 버전** 범위의 항목을 필터링하여 안내:

```
━━━ 🆕 신규 기능 안내 ━━━━━━━━━━━━━━━━
v{version}: {title}
  {description}
  👉 {detail}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

각 feature의 `action` 필드에 따라 안내 방식 분기:
- `none`: "별도 설정 불필요" — 정보성 안내만
- `recommend`: "권장 설정" — 설정 방법 안내 (선택)
- `required`: "필수 설정" — 설정하지 않으면 기능 제한

해당 버전 범위에 features가 없으면 이 단계를 스킵한다.

## 출력

필수 포함: 버전 전환(v{old}→v{new}), 변경 요약(업데이트 디렉토리/추가/수정/삭제 수), 복원 커스터마이징 목록, 스키마 마이그레이션 결과, **신규 기능 안내** (있을 때만), 백업 위치, 롤백 명령어, CHANGELOG 발췌

## 업데이트 대상 (프레임워크 파일)

| 디렉토리 | 설명 |
|---------|------|
| `.claude/agents/` | 에이전트 정의 |
| `.claude/skills/` | 스킬 구현 |
| `.claude/domains/` | 도메인 설정 (커스텀 파일/항목은 감지→복원) |
| `.claude/rules/` | 도메인 × 언어 교차 제약 룰 (Phase 4 도입, v2.0.0+) |
| `.claude/templates/` | CLAUDE.md.tmpl, README.md.tmpl 등 |
| `.claude/schemas/` | project.schema.json, migrations.json, secrets-patterns.schema.json, lessons-learned.schema.json |
| `.claude/workflows/` | 워크플로우 YAML |
| `.claude/docs/` | 프레임워크 문서 |

**머지 방식**: `.claude/settings.json` — 새 권한만 추가 머지 (기존 커스텀 권한 보존)

## 보존 대상 (프로젝트 파일)

- `.claude/state/*` — **디렉토리 전체 보존** (사용자 누적 데이터). 주요 파일: `backlog.json`, `completed.json`, `lessons-learned.json` (Phase 7), `health-history.json`, `continuation-plan.md` 등
  - **v1 → v2 backlog 호환**: `backlog.schema.json`은 v1.x ↔ v2 사이 차이가 없어 변환 룰 불필요. `migrations.json`은 `project.json`만 다루며 `backlog.json`은 그대로 보존된다. v1 시기 `step.description` / `step.estimatedLines` 같은 옵셔널 필드도 현 schema에 옵셔널로 포함되어 검증 통과 (Issue #65, 회귀 보호: `tests/upgrade/test_backlog_compat.py`).
- `.claude/settings.local.json` — 로컬 권한 override
- `.claude/temp/` — 진행 중 plan 파일, 백업 디렉토리
- `.claude/plans/` — 사용자 plan 산출물
- `CLAUDE.md` — 재생성 + `CUSTOM_SECTION` 보존
- `README.md` — 재생성 + `CUSTOM_SECTION` 보존
- `VERSION`, `CHANGELOG.md`, `docs/`, `src/` 등 프로젝트 자산

## 안전장치

| 장치 | 설명 |
|------|------|
| 잠금 파일 | `.claude/temp/.upgrade.lock` — Step 11~14 구간 보호 |
| 진행 상태 | `.claude/temp/upgrade-state.json` — 중단 시 복구 참조 |
| 디스크 검증 | Step 1 `df -h` |
| 백업 무결성 | Step 9 `tar tzf` 검증 |
| 자동 롤백 | Step 11 교체 중 오류 → 즉시 백업 복원 |
| SHA256 해시 | Step 6-0 전체 프레임워크 파일 해시 비교 → 사용자 수정 파일 감지 |
| CUSTOM_SECTION 마커 | Step 10-0 사전 확인 + Step 13-0 누락 시 자동 삽입 |

## 주의사항
- Git 상태가 clean한 상태에서 실행 권장
- 업그레이드 후 `git diff`로 변경사항 확인 권장
- 문제 발생 시 `--rollback`으로 즉시 복원 가능
