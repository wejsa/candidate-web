---
id: sample-rule
domain: _example
language: _example
severity: MAJOR
triggers:
  - "<여기에 정규식 패턴>"
related:
  - "../../../domains/_base/conventions/<관련 conventions>"
---

# 예시 도메인 × 예시 언어: 샘플 룰 제목

> 본 파일은 **rules 작성 가이드용 학습 템플릿**입니다.
> `_example/_example/` 경로는 `.claude/rules/README.md`의 language 매핑 표에 없으므로
> 실제 PR 리뷰에 적용되지 않습니다.

## 제약 (MUST / MUST NOT)

- **MUST NOT**: `<도메인>` 영역에서 `<언어>`로 `<위험한 패턴>`을 직접 사용 금지
- **MUST**: `<안전한 대체 패턴>`을 사용
- **MUST**: `<추가 강제 사항>`

> 도메인 비즈니스 의미를 담은 강제 사항만 작성합니다.
> "Claude가 이미 아는 기술 사용법"(라이브러리 API, 언어 문법)은 여기에 작성하지 않습니다.

## 좋은 예

```text
// 모범 패턴 (실제 작성 시 해당 언어로 교체)
// 도메인 제약을 만족하는 코드
SafePattern.create()
  .withDomainConstraint(value)
  .build()
```

## 나쁜 예

```text
// 안티패턴 (실제 작성 시 해당 언어로 교체)
// 도메인 제약을 위반하는 코드
DirectAccess(rawDomainValue)  // ✗ 위험: 도메인 규칙 우회
```

## 안전한 대체 패턴

- 안티패턴을 발견했을 때 어떻게 고칠지 구체적으로 안내합니다.
- 가능하면 헬퍼 함수, 미들웨어, ORM 레이어, 코드 생성 도구 등 *구조적 해결책*을 제시합니다.
- 임시 우회(주석 처리, suppress 어노테이션)는 권장하지 않습니다.

## 근거

- 컴플라이언스 표준 / 법규 (예: HIPAA Privacy Rule §164.514, GDPR Art. 32)
- 도메인 docs 링크 (예: `domains/<domain>/docs/<관련 흐름>.md`)
- 내부 인시던트 사례 (있을 경우, 비식별화하여)
- 외부 표준 / 베스트 프랙티스 링크

---

## 작성 시 체크리스트

이 템플릿을 복사해 새 룰을 작성할 때 다음을 확인하세요:

- [ ] frontmatter `id`가 파일명과 일치
- [ ] `domain`이 `.claude/domains/_registry.json`에 등록됨
- [ ] `language`가 `rules/README.md` 매핑 표 우측 값에 포함됨
- [ ] `severity` 선택 근거가 본문에 드러남
- [ ] 좋은 예 / 나쁜 예 코드 블록 각 1개 이상
- [ ] 안전한 대체 패턴이 *구조적 해결책*을 제시함
- [ ] 근거에 컴플라이언스/도메인 docs 링크 포함
- [ ] "Claude가 이미 아는 기술 사용법"이 아닌 *도메인 비즈니스 제약*인지 검토
- [ ] conventions(`_base/conventions/`)와 중복되지 않는지 확인
