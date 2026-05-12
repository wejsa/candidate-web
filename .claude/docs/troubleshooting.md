# 트러블슈팅 가이드

AI Crew Kit 사용 중 발생할 수 있는 문제와 해결 방법.

---

## 1. 세션 크래시 / 워크플로우 중단

### 증상
- 자동 체이닝(`impl → review → merge`) 중 세션 종료
- `/skill-status`에서 Task가 `in_progress`이나 진행이 안 됨

### 진단
```
/skill-status
```
- `워크플로우 상태` 섹션에서 Stale(30분+ 미갱신) 확인
- `workflowState.currentSkill`로 중단 지점 파악

### 해결

**중단 지점별 복구:**

| 중단 지점 | 복구 명령 | 설명 |
|----------|----------|------|
| skill-impl | `/skill-impl` | 현재 스텝 구현 재개 |
| skill-review-pr | `/skill-review-pr {prNumber}` | PR 리뷰 재실행 |
| skill-fix | `/skill-fix {prNumber}` | PR 수정 재실행 |
| skill-merge-pr | `/skill-merge-pr {prNumber}` | PR 머지 재실행 |

**Task 완전 초기화:**
```
/skill-backlog update {taskId} --status=todo
```

---

## 2. backlog.json 깨짐 (JSON 파싱 실패)

### 증상
```
❌ backlog.json이 유효한 JSON이 아닙니다.
```

### 원인
- 멀티 세션 동시 쓰기로 JSON merge conflict
- 비정상 종료 중 파일 쓰기 불완전

### 해결

**1단계: Git에서 복원 시도**
```bash
git checkout -- .claude/state/backlog.json
```

**2단계: 최근 정상 버전 확인**
```bash
git log --oneline -10 -- .claude/state/backlog.json
git show {commit}:.claude/state/backlog.json > /tmp/backlog-check.json
python3 -c "import json; json.load(open('/tmp/backlog-check.json'))" && echo "OK"
```

**3단계: 수동 복구**
- 백업에서 복원: `git show {정상커밋}:.claude/state/backlog.json > .claude/state/backlog.json`
- JSON 유효성 검증: `python3 -c "import json; json.load(open('.claude/state/backlog.json'))"`
- 커밋: `git add .claude/state/backlog.json && git commit -m "fix: backlog.json 복구"`

### 예방
- `metadata.version` 카운터로 동시 쓰기 감지
- 모든 쓰기 후 JSON 유효성 자동 검증 (skill-backlog 프로토콜)

---

## 3. PR 머지 실패

### 증상
```
❌ 머지 불가: PR 미승인 / CI 실패 / 충돌 발생
```

### 해결

**미승인:**
```
/skill-review-pr {prNumber}
```

**CI 실패:**
1. `gh pr checks {prNumber}`로 실패 항목 확인
2. 코드 수정 후 push
3. `/skill-merge-pr {prNumber}` 재시도

**충돌:**
```bash
# PR 브랜치 체크아웃
gh pr checkout {prNumber}

# develop 머지
git merge develop

# 충돌 해결 후
git add .
git commit -m "fix: merge conflict 해결"
git push

# 재시도
/skill-merge-pr {prNumber}
```

---

## 4. 잠금 만료 (Lock Expired)

### 증상
- `/skill-status --locks`에서 `🔴 만료` 표시
- 다른 세션에서 같은 Task 접근 불가

### 해결

**정상 해제 (잠금 만료 후):**
- 만료된 Task는 자동으로 다른 세션에서 인계 가능

**강제 해제:**
```
/skill-backlog unlock {taskId} --force
```
- "I understand the risks" 입력 필요
- 원래 담당자가 작업 중일 수 있으므로 주의

---

## 5. 계획 파일 누락

### 증상
```
❌ 계획 파일이 없습니다. /skill-plan을 먼저 실행하세요.
```

### 원인
- `.claude/temp/{taskId}-plan.md`가 삭제됨
- 세션 초기화 후 temp 디렉토리 정리

### 해결
```
/skill-plan {taskId}
```
- 기존 backlog.json의 steps 정보를 참조하여 계획 재수립
- 승인 후 `/skill-impl`로 재개

---

## 6. 업그레이드 실패

### 증상
- `/skill-upgrade` 중 오류 발생
- `.claude/temp/.upgrade.lock` 잔존

### 해결

**롤백:**
```
/skill-upgrade --rollback
```

**잠금 파일 수동 제거 (롤백 불가 시):**
```bash
rm .claude/temp/.upgrade.lock
rm .claude/temp/upgrade-state.json
```

**검증:**
```
/skill-validate
```

---

## 7. 도메인/스킬 파일 손상

### 진단
```
/skill-validate
```

### 해결
- FAIL 항목 확인 후 수동 수정
- `--fix` 옵션으로 자동 복구 가능 항목 처리:
  ```
  /skill-validate --fix
  ```

---

## 8. Git 원격 동기화 문제

### 증상
- `git push` 실패 (rejected)
- 멀티 세션 간 상태 불일치

### 해결
```bash
# 최신 상태 가져오기
git fetch origin develop

# Rebase 시도
git rebase origin/develop

# 충돌 시 수동 해결
# JSON 파일 충돌: 두 변경사항 모두 유지하며 JSON 유효성 확인

# 재푸시
git push origin develop
```

---

## skill-fix 루프 (2회 초과)

**증상**: CRITICAL 이슈가 auto-fix 후에도 반복 발견되어 워크플로우가 중단됨

**원인**: 자동 수정으로 해결할 수 없는 근본적 설계 문제 (보안 취약점, 아키텍처 위반 등)

**해결**:
1. REQUEST_CHANGES 출력 내용 확인
2. CRITICAL 이슈 목록에서 수동 수정 필요 항목 파악
3. 코드 수정 후 커밋 → push
4. `/skill-review-pr {번호}` 재실행

> 루프 가드: 같은 PR에 대해 skill-fix는 **최대 2회**만 실행됩니다. 3회째 CRITICAL 발견 시 REQUEST_CHANGES 후 즉시 중단합니다.

---

## origin/develop과 다수 커밋 차이

**증상**: "origin/develop과 5커밋 이상 차이" 경고 또는 push 실패

**원인**: 다른 세션에서 develop에 다수 커밋이 추가된 후 로컬이 동기화되지 않음

**해결**:
```bash
git fetch origin develop
git merge origin/develop
# 충돌 시 develop(최신) 우선으로 해결
git push origin develop
```

> 장시간 작업 시 주기적으로 `git fetch origin develop`을 실행하여 차이를 줄이세요.

---

## 진단 명령 요약

| 명령 | 용도 |
|------|------|
| `/skill-status` | 전체 상태 확인 |
| `/skill-status --health` | 시스템 건강 점검 |
| `/skill-status --locks` | 잠금 현황 확인 |
| `/skill-validate` | 프레임워크 무결성 검증 |
| `/skill-backlog list` | 백로그 상태 확인 |
