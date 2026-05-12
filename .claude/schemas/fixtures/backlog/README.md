# .claude/schemas/fixtures/backlog/ — backlog.schema.json 검증 고정값

Issue #62 (v2.1.0 PR #61 후속) — skill-init Step 9 백로그 자동 분해 결과의 회귀 보호.

`tests/skill-init/test_schema_compliance.py`가 pytest로 본 디렉토리의 fixture를 모두 검증.

## 구조

```
backlog/
├── positive/                                    스키마가 ✅ 통과해야 하는 케이스
│   ├── empty-backlog.json                       Step 9 N/C 분기 결과
│   ├── full-backlog-with-phases.json            Step 9 Y/A 분기 (4 phase × 3 task)
│   └── fintech-with-critical-priority.json      컴플라이언스 격상 케이스
│
└── negative/                                    스키마가 ❌ 거부해야 하는 케이스
    ├── task-current-step-zero.json              currentStep:0 → minimum:1 위반
    ├── task-spec-file-null.json                 specFile:null → type:string 위반
    ├── task-type-invalid-enum.json              type:"refactor" 차단
    ├── task-priority-invalid-enum.json          priority:"urgent" 차단
    ├── task-id-lowercase.json                   id pattern 위반
    ├── phase-status-blocked.json                phase status enum 위반
    ├── metadata-missing-required.json           metadata 필수 필드 누락
    └── summary-negative-count.json              summary.total = -1 (minimum:0 위반)
```

## 추가 규칙

- positive 케이스 추가: skill-init Step 9 신규 분기/필드 도입 시 함께 추가
- negative 케이스 추가: backlog.schema.json 제약 추가/강화 시 위반 예시 포함
- 파일명은 케이스를 자체 설명 (kebab-case)
- **각 negative fixture는 단 하나의 위반만 포함** — 실패 원인이 명확하도록

## 참고

- 본 fixture는 `project.schema.json` fixture (`../positive/`, `../negative/`)와 구분됨
- pytest 검증: `pytest tests/skill-init/test_schema_compliance.py -v`
