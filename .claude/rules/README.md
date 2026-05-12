# Constraint Rules — 도메인 × 언어 교차 제약 규칙

> Phase 4 (v2.0.0-alpha.3+) 도입.
> 본 디렉토리는 **메커니즘만** 제공합니다. 실제 도메인 × 언어 룰 콘텐츠는 사용자가 필요 시 직접 추가합니다.

## 무엇인가

`.claude/rules/{domain}/{language}/*.md`는 **도메인 비즈니스 제약**을 언어별로 명시하는 파일입니다. PR 리뷰 시 `skill-review-pr`이 자동으로 참조하여 `pr-reviewer-domain` 에이전트에게 컨텍스트로 전달합니다.

**핵심 원칙**: rules는 *"Claude가 이미 아는 기술"*을 가르치지 않습니다. 도메인 비즈니스 제약(예: HIPAA PHI 보호, 멀티테넌시 격리)만 명문화합니다.

## rules vs conventions — 어떻게 다른가

| 축 | `_base/conventions/` | `rules/{domain}/{language}/` |
|----|----------------------|------------------------------|
| 강제도 | SHOULD (권장) | **MUST / MUST NOT** (제약) |
| 적용 범위 | 도메인 무관 또는 언어 단독 | **도메인 × 언어 교차에서만** |
| 위반 시 | 리뷰에서 권고 | 리뷰에서 **CRITICAL/MAJOR 지적** |
| 예시 | "Pydantic 스키마 분리" | "PHI 변수를 logger 인자로 전달 금지" |
| 형식 | prose md | **frontmatter 필수** + prose + 좋은/나쁜 코드 예시 |
| 위치 | `.claude/domains/_base/conventions/` (1곳) | `.claude/rules/{domain}/{language}/` (교차점) |

**중복 회피 규칙**:
1. conventions에 있는 내용을 rules에 중복 기술하지 않습니다.
2. rules는 반드시 도메인 + 언어 교차점에서만 존재합니다. `_base/rules/`와 `{domain}/rules/`는 만들지 않습니다.
3. 단독 도메인 룰은 `{domain}/checklists/`로, 단독 언어 권장사항은 `_base/conventions/`로 작성합니다.

## language 매핑 (SSOT)

`project.json`의 `techStack.backend` 값을 다음 매핑으로 rules 디렉토리명으로 변환합니다. **이 표가 SSOT입니다** — `skill-review-pr`이 직접 참조합니다.

| `techStack.backend` | rules 디렉토리 | 비고 |
|--------------------|---------------|------|
| `spring-boot-kotlin` | `kotlin` | |
| `spring-boot-java` | `java` | |
| `nodejs-typescript` | `typescript` | |
| `python-fastapi` | `python` | FastAPI/Django 공통 `python` |
| `python-django` | `python` | |
| `go` | `go` | |
| `none` | (스킵) | rules 로드 단계 SKIP |

> **frontend 매핑은 v2.0 MVP 범위 외**입니다. 향후 Phase에서 `techStack.frontend` (nextjs/react/vue)를 별도 매핑하거나 `typescript`/`javascript`로 통합할 예정.

## frontmatter 표준

모든 rules 파일은 다음 frontmatter를 **필수**로 포함합니다.

```yaml
---
id: <kebab-case>             # 파일명과 동일 (확장자 제외)
domain: <healthcare|fintech|saas|ecommerce|general|_example>
language: <python|kotlin|typescript|java|go|_example>
severity: <CRITICAL|MAJOR|MINOR>
triggers:                    # 정규식 목록 (LLM 컨텍스트 힌트, 자동 차단 아님)
  - "<regex>"
related:                     # 관련 도메인 docs/checklists 상대 경로
  - "<상대 경로>"
---
```

| 필드 | 필수 | 설명 |
|------|:---:|------|
| `id` | ✅ | 파일명과 동일한 kebab-case 식별자 |
| `domain` | ✅ | `.claude/domains/_registry.json`에 등록된 도메인 또는 `_example` |
| `language` | ✅ | 위 매핑 표의 우측 값 또는 `_example` |
| `severity` | ✅ | 위반 시 리뷰 심각도 |
| `triggers` | 권장 | LLM이 코드를 빠르게 스캔할 때 사용하는 정규식 힌트. 부재해도 무방 |
| `related` | 권장 | 도메인 docs/checklists 링크 (상대 경로) |

## 파일 본문 구조

frontmatter 다음에 다음 섹션을 권장합니다(고정 형식 아님):

````markdown
# <도메인> × <언어>: <룰 제목>

## 제약 (MUST / MUST NOT)
- 제약 1
- 제약 2

## 좋은 예
```<language>
// 모범 패턴
```

## 나쁜 예
```<language>
// 안티패턴
```

## 안전한 대체 패턴
- 안티패턴 대신 사용할 수 있는 방법

## 근거
- 컴플라이언스 / 도메인 docs / 표준 링크
````

> **좋은/나쁜 예시 코드 블록은 필수**입니다. 텍스트만 있는 룰은 LLM이 패턴 학습하기 어렵습니다.

## 새 rule 작성 가이드라인

1. **"Claude가 이미 아는 기술"을 가르치지 마세요**
   - ✗ "Python에서 with 문으로 파일을 닫으세요" (언어 사용법)
   - ✗ "Pydantic으로 스키마를 분리하세요" (라이브러리 사용법)
   - ✓ "환자 식별자를 logger 인자에 직접 전달 금지" (도메인 제약)
   - ✓ "결제 금액 계산은 BigDecimal + RoundingMode.HALF_EVEN" (도메인 제약)

2. **MUST / MUST NOT 형식으로 명시하세요**
   - SHOULD 수준이면 conventions에 작성하세요.
   - rules는 위반 시 리뷰에서 CRITICAL/MAJOR로 지적되는 강제 사항입니다.

3. **좋은/나쁜 코드 예시를 반드시 포함하세요**
   - LLM이 패턴 학습하는 핵심입니다.
   - 추상적 설명만으로는 false negative 발생 위험.

4. **triggers 정규식은 false positive를 허용합니다**
   - 자동 차단이 아니라 LLM 스캔 힌트입니다.
   - 의심 케이스를 LLM이 컨텍스트로 판단합니다.

5. **related 링크로 도메인 docs와 연결하세요**
   - rules는 도메인 docs/checklists의 *언어 차원 강화*입니다. 동일 주제가 도메인 문서에 있으면 링크하세요.

## 예시 템플릿

학습용 예시는 `_example/_example/sample-rule.md`를 참조하세요. 해당 파일은 frontmatter 표준과 본문 구조를 시연합니다.

`_example/_example/` 경로는 위 language 매핑 표에 없으므로 **실제 PR 리뷰에 적용되지 않습니다**. 순수 가이드용입니다.

## 현재 정책

- **MVP 단일 디렉토리 구조**: 도메인 × 언어 단일 교차점에서만 rules가 존재합니다.
- **`overridePriority` 분기 미구현**: `project.json`의 `overridePriority` 필드는 schema에 enum이 정의되어 있으나 v2.0 MVP에서는 분기 로직이 작동하지 않습니다(단일 디렉토리 구조라 충돌이 발생하지 않음). 향후 단독 도메인/언어 룰이 도입될 때 활성화됩니다.
- **콘텐츠 0개로 시작**: v2.0.0-alpha.3은 메커니즘만 제공합니다. 사용자가 필요 시 자신의 도메인 × 언어 조합으로 rule을 추가합니다.

## 금지 항목

- ❌ `.claude/rules/_base/` — 단독 베이스 룰 디렉토리 신규 생성 금지
- ❌ `.claude/rules/{domain}/` — 언어 없는 단독 도메인 룰 디렉토리 신규 생성 금지 (도메인 단독 룰은 `domains/{domain}/checklists/`로 작성)
- ❌ `.claude/rules/{language}/` — 도메인 없는 단독 언어 룰 디렉토리 신규 생성 금지 (언어 단독 권장은 `domains/_base/conventions/`로 작성)
- ❌ Claude가 이미 아는 기술 사용법 (라이브러리 API, 언어 문법, 일반 보안)
- ❌ frontmatter 누락

## 새 도메인 × 언어 추가 절차

1. `.claude/rules/{domain}/{language}/` 디렉토리 생성 (도메인은 `_registry.json` 등록 필수, language는 위 매핑 표 우측 값)
2. `{rule-id}.md` 파일을 frontmatter 표준에 맞춰 작성
3. 좋은/나쁜 예시 코드 블록 필수 포함
4. PR로 v2-develop에 머지
5. 다음 PR 리뷰부터 자동 적용

## skill-review-pr 통합

> **상태**: 본 통합은 Phase 4 Step 2(별도 PR)에서 도입됩니다. 현재 v2.0.0-alpha.3 시점에는 rules 디렉토리가 존재해도 `skill-review-pr`이 자동 참조하지 않습니다.

도입 후 `skill-review-pr`의 Step 2.5에서 다음 흐름으로 rules를 로드할 예정입니다.

```
1. project.json의 domain, techStack.backend 읽기
2. language 매핑 (위 표)
3. .claude/rules/{domain}/{language}/*.md 글롭
4. 매칭 파일 경로를 rules_paths 리스트에 수집
5. 부재 시 SKIP (기존 동작 유지)
6. Trivial 경량 리뷰 시 SKIP
7. _example/_example/는 매핑 표에 없으므로 자연 SKIP
```

매칭된 rules는 `pr-reviewer-domain` 에이전트에게 파일 경로 목록으로 전달됩니다. 에이전트가 Read로 자유롭게 참조하여 PR diff와 대조합니다.

## 참고

- 상위 설계: [docs/v2/phase-4-rules.md](https://github.com/wejsa/ai-crew-kit/blob/main/docs/v2/phase-4-rules.md)
- TFT 분석: [docs/v2/phase-4-tft-analysis.md](https://github.com/wejsa/ai-crew-kit/blob/main/docs/v2/phase-4-tft-analysis.md)
- 구현 계획: [docs/v2/phase-4-plan.md](https://github.com/wejsa/ai-crew-kit/blob/main/docs/v2/phase-4-plan.md)
- Layered Override: [docs/concepts.md](https://github.com/wejsa/ai-crew-kit/blob/main/docs/concepts.md)
- 커스터마이징: [docs/customization.md](https://github.com/wejsa/ai-crew-kit/blob/main/docs/customization.md)

> 이 링크들은 ai-crew-kit GitHub 리포를 가리킵니다. 사용자 프로젝트에는 `docs/`가 포함되지 않으므로 (skill-init/skill-onboard에서 자동 정리), 항상 GitHub URL로 참조합니다. **버전 주의**: `blob/main`은 항상 최신을 가리키므로 사용자 시드 시점(`project.json.kitVersion`)과 다를 수 있습니다. 시드 시점 문서를 보려면 `blob/{태그}` (예: `blob/v2.0.1`) 형태로 직접 변경하세요.
