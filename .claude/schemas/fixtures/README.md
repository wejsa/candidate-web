# .claude/schemas/fixtures/ — project.schema.json 검증 고정값

`scripts/validate-schema.sh`와 CI가 사용하는 positive/negative 케이스.

## 구조

```
fixtures/
├── positive/          스키마가 ✅ 통과해야 하는 케이스
│   ├── v1-legacy-no-hooks.json         v1.x 프로젝트 — hooks 필드 부재 (하위호환)
│   ├── v2-empty-hooks.json             v2.0.0-alpha.1 Step 1 예약 구조 (빈 배열)
│   ├── v2-full-hooks.json              v2.0.0-alpha.2 Step 2~3 전체 훅 등록
│   ├── v2-future-events.json           v2.1+ PreToolUse/UserPromptSubmit 확장 경로
│   ├── v2-review-mode-full.json        v2.3+ review.mode='full' 명시
│   ├── v2-review-agents-custom.json    v2.3+ review.agents 커스텀 조합
│   ├── v2-review-thresholds-full.json  v2.3+ review.thresholds 3키 모두 명시
│   └── v2-review-thresholds-partial.json v2.3+ review.thresholds 부분(critical만) — 나머지는 독립 fallback
│
└── negative/          스키마가 ❌ 거부해야 하는 케이스
    ├── unknown-event.json              정의되지 않은 훅 이벤트명
    ├── missing-command.json            hooks[].command 필드 누락 (required 위반)
    ├── timeout-out-of-range.json       timeout > 60 (maximum 위반)
    ├── empty-hooks-array.json          hooks[] 배열 비어있음 (minItems 1 위반)
    ├── additional-property.json        허용되지 않은 필드 포함
    ├── excludepaths-legacy.json        TFT R1에서 제거된 excludePaths 커스텀 키
    ├── review-mode-and-agents-both.json review.mode + review.agents 동시 설정 (not 제약 위반)
    ├── review-critical-below-minimum.json review.thresholds.critical < 50 (minimum 위반 — false-positive 게이트 무력화 차단)
    ├── review-agents-unknown.json      review.agents에 enum 외 값 (domain/security/test 외 'perf' 등)
    ├── review-agents-missing-domain.json review.agents에 domain 누락 (contains 제약 위반)
    └── review-thresholds-ordering-violation.json review.thresholds 순서 위반 (critical=60 < major=90).
                                          JSON Schema cross-field 비교 불가하므로 validate-schema.sh의 별도 ordering 검증 블록에서 처리.
```

## 추가 규칙

- positive 케이스 추가: 새 기능/이벤트 화이트리스트 확장 시 반드시 함께 추가
- negative 케이스 추가: 스키마에 제약을 추가할 때 그 제약을 위반하는 예시 포함
- 파일명은 케이스를 자체 설명하도록 (kebab-case)

## STRICT 모드 (M-new3)

`scripts/validate-schema.sh`는 기본적으로 `check-jsonschema` 또는 `python3 jsonschema`가 없으면 JSON 구문만 체크하고 PASS로 기록. 이는 개발 편의상 허용된 "연한 PASS"이나 false-positive 위험.

CI/릴리스 검증 시 `SCHEMA_VALIDATOR_STRICT=1`을 설정:

```bash
SCHEMA_VALIDATOR_STRICT=1 bash scripts/validate-schema.sh
# 검증 도구 미설치 시 → exit 77 (skip 시그널)로 조기 종료, PASS로 위장 방지
```

`.github/workflows/schema-validation.yml`이 `SCHEMA_VALIDATOR_STRICT=1`을 자동 설정.
