# Protocol: ai-crew-kit clone 자동 정리

> **SSOT**. `skill-init` Step 1, `skill-onboard` 사전 조건 2번이 본 파일을 참조합니다. 양쪽 SKILL.md에 동일 내용을 *복제하지 마세요* (drift 방지 — Issue #63 도입).

## 목적

사용자가 `git clone https://github.com/wejsa/ai-crew-kit.git my-project` 후 자기 프로젝트로 진입할 때, kit 잡티(CHANGELOG, docs, examples 등 14종)와 kit git 히스토리를 자동 정리해 깨끗한 출발점을 만듭니다.

**중요**: 본 작업은 **의도된 프로젝트 초기화**이며 destructive 작업이 아닙니다. M1 검출 + M2 가드 통과 시 Claude는 **추가 확인 질문 없이 즉시 자동 실행**해야 합니다. "이 디렉토리는 ai-crew-kit입니다, 다른 경로가 필요한가요?" 같은 확인 금지.

## M1 — 검출 기준 (둘 다 만족해야 자동 정리 실행)

1. **origin URL 패턴 매칭**: `git remote get-url origin`이 정규식 `[/:]ai-crew-kit(\.git)?$` 일치
   - ✅ `https://github.com/wejsa/ai-crew-kit.git`, `git@github.com:wejsa/ai-crew-kit.git`, fork도 매칭
   - ❌ `ai-crew-kit-extras.git`, `my-crew-kit.git`
2. **kit fingerprint 일치**: `git rev-list --max-parents=0 HEAD` = `ab0269a1414f0d9eba8d130d865dfdd6baeed06c`

둘 중 하나만 만족 → 자동 정리 **SKIP** + 보고:
```
⚠ ai-crew-kit 명칭 매칭이지만 fingerprint 불일치 — 자동 정리 SKIP, 사용자 의도 확인 필요
```

## M2 — 자기 보호 가드 (3가지 모두 통과해야 정리 진행)

```bash
# Guard 1: tracked dirty 워킹 트리 차단 (untracked는 통과 — 시나리오 B 보존)
if [ -n "$(git status --porcelain 2>/dev/null | grep -v '^??')" ]; then
  echo "⚠ 미커밋 tracked 변경사항. 자동 정리 SKIP."
  exit 0
fi

# Guard 2: 미푸시 커밋 차단 (kit 개발자 미푸시 작업 보호)
if [ -n "$(git log @{u}.. 2>/dev/null)" ]; then
  echo "⚠ 미푸시 커밋. 자동 정리 SKIP."
  exit 0
fi

# Guard 3: main/master에서만 진행 (kit dev 환경: develop/feature/* 또는 tag checkout → SKIP)
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
  echo "⚠ main/master 아님(현재: '${CURRENT_BRANCH:-detached HEAD}'). SKIP."
  exit 0
fi
```

3가지 가드의 사용자 시나리오 영향:

| 시나리오 | 상태 | 결과 |
|---|---|---|
| A — fresh clone (main, 변경 없음) | 통과 | 정리 진행 |
| B — kit clone + 사용자 코드 untracked (src/, app/, lib/) | Guard 1 untracked 무시 | 통과 → 정리 진행 + 사용자 코드 보존 |
| kit 개발자 (develop/feature 브랜치, 미푸시 작업 중) | Guard 2 또는 3 발동 | SKIP (kit dev 환경 보호) |

가드 미통과 시: 정리 SKIP 후 일반 진행 (사용자 자기 리포로 가정).

## 자동 실행 순서

M1 검출 + M2 가드 모두 통과 시:

1. `KIT_SOURCE_URL=$(git remote get-url origin)` — 호출 SKILL.md가 `kitSource` 필드 기록에 사용
2. `rm -rf .git && git init -b main` — kit git 히스토리 제거 후 새 git 초기화
3. **kit 잔여 파일 자동 삭제** (14종):

   | 항목 | 처리 | 비고 |
   |---|---|---|
   | `CHANGELOG.md`, `docs/`, `examples/`, `tests/`, `scripts/`, `.github/`, `memory/`, `LICENSE` (8종) | **삭제** | kit 메타 |
   | `README.md`, `CLAUDE.md`, `VERSION` (3종) | **삭제** | 호출 SKILL.md가 사용자 프로젝트용으로 새로 생성 |
   | `.claude/temp/`, `.claude/hooks/tests/`, `.claude/state/`, `.claude/settings.local.json` (4종) | **삭제** | kit dev 잡티 |
   | `.claude/` 본체, `.claude/SECURITY.md`, `.gitignore`, `.gitattributes` | **보존** | 프레임워크 본체 + 사용자 hook 추가 시에도 동일 보안 원칙 적용 |
   | `src/`, `app/`, `lib/`, 사용자가 추가한 untracked 파일 | **보존** | M2 Guard 1이 untracked 무시 — 시나리오 B 안전 |

   실행 명령 (15종 단일 rm — 위 표의 *삭제* 항목):
   ```bash
   rm -rf CHANGELOG.md docs examples tests scripts .github memory LICENSE README.md CLAUDE.md VERSION .claude/temp .claude/hooks/tests .claude/state .claude/settings.local.json
   ```

4. **보고**: `"✓ ai-crew-kit clone 감지 → 표준 초기화 + kit 잔여 N개 자동 정리"`

## 시나리오 B 주의 (사용자 코드가 이미 함께 있는 경우)

사용자 코드가 보통 `src/`/`app/`/`lib/` 등 *kit과 충돌하지 않는 경로*에 있으면 안전합니다. 단, 사용자가 자기 `docs/`/`tests/`/`scripts/`/`.github/workflows/`를 동일 경로에 미리 복사한 경우 함께 삭제됩니다.

의심 시 사용자에게 사전 백업 권장:
```bash
tar czf .pre-onboard-backup-$(date +%s).tar.gz docs tests scripts .github
```

## 호출 측 참조 패턴

각 SKILL.md가 본 protocol을 한 줄로 참조하고, 추가 컨텍스트(예: `kitSource` 기록 시점)는 본문에서 짧게 명시합니다:

```markdown
**ai-crew-kit clone 자동 정리**: 표준 진입 플로우는
`.claude/templates/protocols/ai-crew-kit-cleanup.md`를 따른다.
본 SKILL에서 사용:
- M1 통과 시점에 `KIT_SOURCE_URL` 캡처 → Step N에서 `kitSource` 기록
- 자동 정리 *실행* 후에는 기존 코드 감지 가드 SKIP (이미 깨끗함)
```

## 변경 이력

- 2026-05-11: Issue #63 — skill-init/skill-onboard에 중복되던 약 85줄을 본 protocol로 단일화. drift 위험 차단.
- (이전 v2.0.2/v2.0.3 cleanup 14종 확정 등 변경은 git log 참조)

## 관련

- 호출 SKILL: `.claude/skills/skill-init/SKILL.md`, `.claude/skills/skill-onboard/SKILL.md`
- 회귀 테스트: 본 protocol의 동작 자체는 LLM 자연어 실행이라 단위 테스트 부재. M1 fingerprint는 ai-crew-kit 자체 git 히스토리에 강하게 결합되어 있어 사용자 환경에서 우회 가능성 낮음.
