# CLAUDE.md 템플릿 엔진 설계

## 개요

AI Crew Kit의 CLAUDE.md 자동 생성 엔진입니다.
프로젝트 설정(project.json)과 도메인 설정(domain.json)을 기반으로 CLAUDE.md를 동적 생성합니다.

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Input Sources                          │
├─────────────────┬─────────────────┬─────────────────────────┤
│ project.json    │ domain.json     │ _base/conventions       │
│ (사용자 설정)    │ (도메인 기본값)  │ (공통 규약)             │
└────────┬────────┴────────┬────────┴────────────┬────────────┘
         │                 │                     │
         ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Layered Override Resolver                      │
│   우선순위: project.json > domain.json > _base              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Template Processor                        │
│   CLAUDE.md.tmpl + Resolved Values → CLAUDE.md              │
└─────────────────────────────────────────────────────────────┘
```

## 마커 정의

### 단순 치환 마커

단일 값으로 치환되는 마커입니다.

| 마커 | 출처 | 기본값 | 설명 |
|------|------|--------|------|
| `{{PROJECT_NAME}}` | project.json → name | "My Project" | 프로젝트명 |
| `{{PROJECT_DESCRIPTION}}` | project.json → description | "" | 프로젝트 설명 |
| `{{DOMAIN_ID}}` | project.json → domain | "general" | 도메인 ID |
| `{{DOMAIN_NAME}}` | domain.json → name | "범용" | 도메인 표시명 |
| `{{DOMAIN_ICON}}` | domain.json → icon | "🔧" | 도메인 아이콘 |
| `{{TASK_PREFIX}}` | project.json → conventions.taskPrefix | domain.defaultTaskPrefix | Task ID 접두사 |
| `{{PR_LINE_LIMIT}}` | project.json → conventions.prLineLimit | 500 | PR 라인 제한 |
| `{{TEST_COVERAGE}}` | project.json → conventions.testCoverage | 80 | 테스트 커버리지 목표 |
| `{{WORKFLOW_PROFILE}}` | project.json → conventions.workflowProfile | "standard" | 워크플로우 프로필 (standard/fast) |
| `{{SKILL_PROFILE}}` | project.json → conventions.skillProfile | "default" | 현재 스킬 프로파일명 |

### 블록 마커

조건부 또는 반복 처리되는 마커입니다.

| 마커 | 생성 로직 | 설명 |
|------|----------|------|
| `{{TECH_STACK_SECTION}}` | techStack 기반 | 기술 스택 목록 |
| `{{AGENTS_SECTION}}` | agents.enabled 기반 | 활성화된 에이전트 목록 |
| `{{CONVENTIONS_SECTION}}` | conventions + domain 기반 | 코딩 컨벤션 |
| `{{DOMAIN_DOCS_MAPPING}}` | domain.keywordMapping 기반 | skill-docs 키워드 매핑 |
| `{{DOMAIN_ERROR_CODES}}` | error-codes.json 기반 | 에러 코드 테이블 |
| `{{DOMAIN_COMPLIANCE}}` | domain.compliance 기반 | 컴플라이언스 목록 |
| `{{CUSTOM_SECTION}}` | project.json → customSections | 사용자 정의 섹션 |
| `{{WORKFLOW_CHAINING_RULES}}` | workflowProfile 기반 | 프로필별 자동 체이닝 규칙 테이블 |
| `{{SKILL_LIST_SECTION}}` | skillProfile + skill-profiles.json 기반 | 프로파일별 스킬 목록 (bash 코드블록) |
| `{{NATURAL_LANGUAGE_COMMANDS}}` | skillProfile + skill-profiles.json 기반 | 프로파일별 자연어 매핑 테이블 |

---

## 치환 로직

### 1. 값 해석 (Layered Override)

```python
def resolve_value(key: str) -> any:
    """
    우선순위:
    1. project.json (최우선)
    2. domain.json
    3. _base conventions
    4. 하드코딩 기본값
    """
    # Step 1: project.json 확인
    value = project_json.get(key)
    if value is not None:
        return value

    # Step 2: domain.json 확인
    domain_id = project_json.get("domain", "general")
    domain_config = load_domain_json(domain_id)
    value = domain_config.get(key)
    if value is not None:
        return value

    # Step 3: _base conventions 확인
    base_conventions = load_base_conventions()
    value = base_conventions.get(key)
    if value is not None:
        return value

    # Step 4: 기본값 반환
    return DEFAULTS.get(key, "")
```

### 2. 단순 마커 치환

```python
def substitute_simple_markers(template: str, values: dict) -> str:
    """
    {{MARKER_NAME}} 형태의 마커를 값으로 치환
    """
    result = template
    for marker, value in values.items():
        result = result.replace(f"{{{{{marker}}}}}", str(value))
    return result
```

### 3. 블록 마커 생성

각 블록 마커는 전용 생성 함수를 사용합니다.

---

## 블록 생성기

### TECH_STACK_SECTION

```python
def generate_tech_stack_section(tech_stack: dict) -> str:
    """
    기술 스택 섹션 생성
    """
    lines = []

    mapping = {
        "backend": "백엔드",
        "frontend": "프론트엔드",
        "database": "데이터베이스",
        "cache": "캐시",
        "infrastructure": "인프라"
    }

    for key, label in mapping.items():
        value = tech_stack.get(key)
        if value:
            lines.append(f"- **{label}**: {value}")

    return "\n".join(lines)
```

**출력 예시:**
```markdown
- **백엔드**: Spring Boot 3 (Kotlin)
- **프론트엔드**: Next.js
- **데이터베이스**: MySQL
- **캐시**: Redis
```

### AGENTS_SECTION

```python
def generate_agents_section(agents: dict) -> str:
    """
    활성화된 에이전트 섹션 생성
    """
    enabled = agents.get("enabled", [])

    agent_info = {
        "pm": {"icon": "🎯", "name": "agent-pm", "role": "총괄 오케스트레이터"},
        "backend": {"icon": "⚙️", "name": "agent-backend", "role": "백엔드 개발"},
        "frontend": {"icon": "🎨", "name": "agent-frontend", "role": "프론트엔드 개발"},
        "code-reviewer": {"icon": "👀", "name": "agent-code-reviewer", "role": "코드 리뷰"},
        "qa": {"icon": "🧪", "name": "agent-qa", "role": "테스트/품질 검증"},
        "docs": {"icon": "📚", "name": "agent-docs", "role": "문서화"},
        "db-designer": {"icon": "🗃️", "name": "agent-db-designer", "role": "DB 설계"},
        "planner": {"icon": "📋", "name": "agent-planner", "role": "기획/요구사항 정의"}
    }

    lines = ["### 활성화된 에이전트", "", "| 에이전트 | 역할 |", "|----------|------|"]

    for agent_id in enabled:
        info = agent_info.get(agent_id, {})
        icon = info.get("icon", "")
        name = info.get("name", agent_id)
        role = info.get("role", "")
        lines.append(f"| {icon} `{name}` | {role} |")

    return "\n".join(lines)
```

**출력 예시:**
```markdown
### 활성화된 에이전트

| 에이전트 | 역할 |
|----------|------|
| 🎯 `agent-pm` | 총괄 오케스트레이터 |
| ⚙️ `agent-backend` | 백엔드 개발 |
| 👀 `agent-code-reviewer` | 코드 리뷰 |
```

### DOMAIN_DOCS_MAPPING

```python
def generate_docs_mapping(domain_config: dict) -> str:
    """
    도메인 참고자료 키워드 매핑 테이블 생성
    """
    keyword_mapping = domain_config.get("keywordMapping", {})

    if not keyword_mapping:
        return ""

    lines = [
        "---",
        "",
        "## 참고자료 자동 참조",
        "",
        "다음 키워드 사용 시 관련 참고자료가 자동 참조됩니다:",
        "",
        "| 키워드 | 참조 문서 |",
        "|--------|----------|"
    ]

    for doc, keywords in keyword_mapping.items():
        keyword_str = ", ".join(keywords)
        lines.append(f"| {keyword_str} | `{doc}` |")

    return "\n".join(lines)
```

**출력 예시:**
```markdown
---

## 참고자료 자동 참조

다음 키워드 사용 시 관련 참고자료가 자동 참조됩니다:

| 키워드 | 참조 문서 |
|--------|----------|
| 결제, 승인, 인증 | `payment-flow.md` |
| 정산, 수수료, D+N | `settlement.md` |
| 취소, 환불 | `refund-cancel.md` |
```

### CONVENTIONS_SECTION (레이지 로딩 — 트리거 테이블)

```python
def generate_conventions_section(project: dict, domain: dict) -> str:
    """
    컨벤션 레이지 로딩 트리거 테이블 생성
    컨벤션 전체 내용을 인라인하지 않고, 트리거 조건 + 파일 경로 참조 테이블을 생성한다.
    스킬 실행 시 해당 트리거에 매칭되면 Read 도구로 파일을 로드한다.
    """
    domain_id = domain.get("id", "general")

    # _base 컨벤션 + 도메인 docs를 조합하여 트리거 테이블 생성
    base_conventions = [
        ("API 엔드포인트 설계/수정", ".claude/domains/_base/conventions/api-design.md", "필수"),
        ("DB 스키마/쿼리 작성", ".claude/domains/_base/conventions/database.md", "필수"),
        ("Redis 키/TTL 설정", ".claude/domains/_base/conventions/cache.md", "필수"),
        ("테스트 작성", ".claude/domains/_base/conventions/testing.md", "필수"),
        ("보안 관련 코드", ".claude/domains/_base/conventions/security.md", "필수"),
        ("메시지 큐 사용", ".claude/domains/_base/conventions/message-queue.md", "필수"),
        ("배포 설정 변경", ".claude/domains/_base/conventions/deployment.md", "필수"),
        ("네이밍 규칙 적용", ".claude/domains/_base/conventions/naming.md", "필수"),
        ("프로젝트 구조 변경", ".claude/domains/_base/conventions/project-structure.md", "필수"),
        ("로깅 코드 작성", ".claude/domains/_base/conventions/logging.md", "권장"),
        ("모니터링 설정", ".claude/domains/_base/conventions/monitoring.md", "권장"),
        ("에러 핸들링 코드", ".claude/domains/_base/conventions/error-handling.md", "권장"),
        ("Git 워크플로우", ".claude/domains/_base/conventions/git-workflow.md", "권장"),
        ("*.tsx, *.jsx, *.vue 파일 수정", ".claude/domains/_base/conventions/frontend-component.md", "필수"),
        ("*.test.tsx, *.spec.tsx, *.stories.tsx", ".claude/domains/_base/conventions/frontend-testing.md", "필수"),
        ("*.css, *.scss, tailwind.config.*", ".claude/domains/_base/conventions/frontend-styling.md", "필수"),
        ("*Store*, *Context*, use*.ts hooks", ".claude/domains/_base/conventions/frontend-state.md", "권장"),
    ]

    # 도메인별 docs 추가 (domain.json의 keywords에서 추출)
    domain_docs = []
    for keyword_group in domain.get("keywords", {}).values():
        for doc in keyword_group.get("docs", []):
            trigger = ", ".join(keyword_group.get("triggers", []))
            path = f".claude/domains/{domain_id}/docs/{doc}"
            domain_docs.append((trigger, path, "필수"))

    all_entries = base_conventions + domain_docs

    lines = [
        "## 도메인 컨벤션 참조 (필요 시 Read)",
        "",
        "| 트리거 조건 | 참조 파일 | 필수/권장 |",
        "|------------|----------|----------|",
    ]

    for trigger, path, level in all_entries:
        lines.append(f"| {trigger} | `{path}` | {level} |")

    lines.append("")
    lines.append('⚠️ "필수" 파일은 해당 트리거 조건에서 반드시 Read 도구로 읽은 후 작업할 것.')

    return "\n".join(lines)
```

### WORKFLOW_CHAINING_RULES (프로필별 체이닝 규칙)

```python
def generate_workflow_chaining_rules(project: dict) -> str:
    """
    워크플로우 프로필(standard/fast)에 따라 자동 체이닝 규칙 테이블 생성
    """
    profile = project.get("conventions", {}).get("workflowProfile", "standard")

    if profile == "fast":
        # fast: review-pr/fix 단계 생략, impl → merge-pr 직행
        return "\n".join([
            "| 완료 스킬 | 조건 | 자동 호출 |",
            "|-----------|------|----------|",
            "| skill-feature | 사용자 승인 | → skill-plan |",
            "| skill-plan | 사용자 \"Y\" 승인 | → skill-impl |",
            "| skill-impl | PR 생성 + 빌드/테스트 통과 | → skill-merge-pr {PR번호} |",
            "| skill-merge-pr | 남은 스텝 있음 | → skill-impl --next |",
            "| skill-merge-pr | 마지막 스텝 | Task 완료 처리 후 종료 |",
            "| skill-hotfix | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-rollback | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-retro | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-report | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-onboard | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-estimate | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-create | - | 자동 체이닝 없음 (독립 실행) |",
        ])
    else:
        # standard: 전체 체이닝 (review-pr/fix 포함)
        return "\n".join([
            "| 완료 스킬 | 조건 | 자동 호출 |",
            "|-----------|------|----------|",
            "| skill-feature | 사용자 승인 | → skill-plan |",
            "| skill-plan | 사용자 \"Y\" 승인 | → skill-impl |",
            "| skill-impl | PR 생성 완료 | → skill-review-pr {PR번호} --auto-fix |",
            "| skill-review-pr | APPROVED | → skill-merge-pr {PR번호} |",
            "| skill-review-pr | CRITICAL + --auto-fix | → skill-fix {PR번호} |",
            "| skill-review-pr | REQUEST_CHANGES | ❌ 멈춤 (수정 대기) |",
            "| skill-fix | 수정 완료 | → skill-review-pr {PR번호} --auto-fix |",
            "| skill-merge-pr | 남은 스텝 있음 | → skill-impl --next |",
            "| skill-merge-pr | 마지막 스텝 | Task 완료 처리 후 종료 |",
            "| skill-hotfix | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-rollback | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-retro | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-report | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-onboard | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-estimate | - | 자동 체이닝 없음 (독립 실행) |",
            "| skill-create | - | 자동 체이닝 없음 (독립 실행) |",
        ])
```

### SKILL_LIST_SECTION (프로파일 기반 스킬 목록)

```python
# 스킬별 정규 데이터 — 커맨드 + 설명 + 자연어 매핑의 단일 소스
SKILL_REGISTRY = {
    "skill-status": {
        "commands": ['/skill-status         # 상태 확인'],
        "nl_mappings": [
            ('"상태 확인해줘"', '`/skill-status`', '프로젝트 상태 확인'),
        ]
    },
    "skill-backlog": {
        "commands": ['/skill-backlog        # 백로그 조회'],
        "nl_mappings": [
            ('"백로그 보여줘"', '`/skill-backlog list`', '백로그 조회'),
            ('"버그만 보여줘"', '`/skill-backlog list --type=bug`', '버그 타입 필터'),
            ('"내 작업 보여줘"', '`/skill-backlog list --assignee=me`', '내 할당 필터'),
            ('"오래된 작업 보여줘"', '`/skill-backlog list --stale=7d`', '장기 미변경 필터'),
            ('"대시보드 보여줘"', '`/skill-backlog dashboard`', 'Phase 진행률 현황'),
            ('"의존성 보여줘"', '`/skill-backlog deps`', '의존성 트리'),
            ('"{ID} 보관해줘"', '`/skill-backlog archive {ID}`', 'Task soft delete'),
            ('"일괄 변경해줘"', '`/skill-backlog batch`', '다중 Task 일괄 변경'),
            ('"버그 등록해줘: {설명}"', '`/skill-backlog add "{설명}" --type=bug`', '버그 등록'),
            ('"Task 추가해줘: {제목}"', '`/skill-backlog add "{제목}"`', 'Task 등록 (type AI 추론)'),
            ('"{ID} 수정해줘"', '`/skill-backlog update {ID}`', 'Task 대화형 수정'),
            ('"{ID} 일시정지해줘"', '`/skill-backlog update {ID} --pause "사유"`', 'Task 일시정지'),
            ('"{ID} 재개해줘"', '`/skill-backlog update {ID} --resume`', '일시정지 Task 재개'),
        ]
    },
    "skill-feature": {
        "commands": ['/skill-feature        # 새 기능 기획 (요구사항 + backlog 등록)'],
        "nl_mappings": [
            ('"새 기능 기획해줘: {기능명}"', '`/skill-feature {기능명}`', '새 기능 기획 + 요구사항 문서'),
        ]
    },
    "skill-plan": {
        "commands": ['/skill-plan           # 다음 작업 + 설계 + 스텝 분리 계획 수립'],
        "nl_mappings": [
            ('"다음 작업 가져와줘"', '`/skill-plan`', 'Task 선택 + 설계 + 스텝 계획'),
        ]
    },
    "skill-impl": {
        "commands": [
            '/skill-impl           # 스텝 개발 + PR 생성',
            '/skill-impl --micro "OO"  # 소규모 수정 (plan 생략, ≤3 파일)',
        ],
        "nl_mappings": [
            ('"개발 진행해줘"', '`/skill-impl`', 'Step 1 개발 -> PR 생성'),
            ('"다음 스텝 진행해줘"', '`/skill-impl --next`', '다음 스텝 개발 -> PR 생성'),
            ('"전체 개발 진행해줘"', '`/skill-impl --all`', '모든 스텝 연속 개발'),
            ('"이어서 진행해줘"', '`/skill-impl --retry`', '실패한 스텝 재시작'),
            ('"스텝 건너뛰기"', '`/skill-impl --skip`', '빌드 실패 스텝 건너뛰기'),
            ('"OO 고쳐줘"', '`/skill-impl --micro "OO"`', '소규모 수정 (규모 자동 판단)'),
            ('"OO 버그 수정해줘"', '`/skill-impl --micro "OO"`', '버그 Micro 경로'),
            ('"간단하게 OO 추가해줘"', '`/skill-impl --micro "OO"`', '소규모 추가 Micro 경로'),
            ('"빌드만 확인해줘"', '`/skill-impl --dry-run`', '빌드/테스트 검증만 (PR 미생성)'),
            ('"테스트 돌려봐"', '`/skill-impl --dry-run`', '빌드/테스트 검증만'),
        ]
    },
    "skill-review": {
        "commands": ['/skill-review         # 코드 리뷰'],
        "nl_mappings": [
            ('"{경로} 코드 리뷰해줘"', '`/skill-review {경로}`', '코드 경로 종합 리뷰'),
        ]
    },
    "skill-review-pr": {
        "commands": ['/skill-review-pr {num}  # PR 코드 리뷰'],
        "nl_mappings": [
            ('"PR {번호} 리뷰해줘"', '`/skill-review-pr {번호}`', 'PR 리뷰'),
        ]
    },
    "skill-merge-pr": {
        "commands": ['/skill-merge-pr {num}   # PR 머지'],
        "nl_mappings": [
            ('"PR {번호} 머지해줘"', '`/skill-merge-pr {번호}`', 'PR 머지'),
        ]
    },
    "skill-docs": {
        "commands": ['/skill-docs           # 참고자료'],
        "nl_mappings": []
    },
    "skill-retro": {
        "commands": ['/skill-retro          # 완료 Task 회고 + 학습 반영'],
        "nl_mappings": [
            ('"회고 해줘"', '`/skill-retro`', '최근 완료 Task 회고'),
            ('"전체 회고 요약해줘"', '`/skill-retro --summary`', '전체 회고 요약'),
        ]
    },
    "skill-hotfix": {
        "commands": ['/skill-hotfix         # main 긴급 수정'],
        "nl_mappings": [
            ('"긴급 수정해줘: {설명}"', '`/skill-hotfix "{설명}"`', 'main 긴급 수정'),
        ]
    },
    "skill-rollback": {
        "commands": ['/skill-rollback       # 릴리스 롤백'],
        "nl_mappings": [
            ('"{태그} 롤백해줘"', '`/skill-rollback {태그}`', '릴리스/PR 롤백'),
        ]
    },
    "skill-report": {
        "commands": ['/skill-report         # 프로젝트 메트릭 리포트'],
        "nl_mappings": [
            ('"리포트 생성해줘"', '`/skill-report`', '프로젝트 메트릭 리포트'),
        ]
    },
    "skill-onboard": {
        "commands": ['/skill-onboard        # 기존 프로젝트 온보딩'],
        "nl_mappings": [
            ('"이 프로젝트에 적용해줘"', '`/skill-onboard`', '기존 프로젝트 온보딩'),
        ]
    },
    "skill-estimate": {
        "commands": ['/skill-estimate       # 작업 복잡도 추정'],
        "nl_mappings": [
            ('"이 작업 얼마나 걸려?"', '`/skill-estimate {TASK-ID}`', '작업 복잡도 추정'),
            ('"스프린트 플래닝 해줘"', '`/skill-estimate --sprint`', '스프린트 플래닝'),
        ]
    },
    "skill-create": {
        "commands": ['/skill-create         # 커스텀 스킬 생성'],
        "nl_mappings": [
            ('"커스텀 스킬 만들어줘: {name}"', '`/skill-create {name}`', '커스텀 스킬 생성'),
        ]
    },
    "skill-domain": {
        "commands": ['/skill-domain         # 도메인 관리'],
        "nl_mappings": []
    },
    "skill-health-check": {
        "commands": ['/skill-health-check   # 코드베이스 건강 검진'],
        "nl_mappings": []
    },
    "skill-release": {
        "commands": ['/skill-release        # 릴리스'],
        "nl_mappings": []
    },
    "skill-upgrade": {
        "commands": ['/skill-upgrade        # 프레임워크 업그레이드'],
        "nl_mappings": []
    },
    "skill-init": {
        "commands": ['/skill-init           # 프로젝트 초기화'],
        "nl_mappings": []
    },
}

def resolve_skill_profile(project: dict) -> list[str]:
    """
    활성 프로파일에 따라 노출할 스킬 이름 목록 반환.
    
    해석 순서:
    1. project.json → conventions.skillProfile 읽기 (기본값: "default")
    2. "default" 또는 None → "full"로 alias
    3. "custom" → project.json → conventions.customSkills 배열 사용
    4. 그 외 → skill-profiles.json에서 프로파일 조회
    5. skills == "*" → .claude/skills/ 하위 전체 - internal 목록
    """
    profile_name = project.get("conventions", {}).get("skillProfile", "default")

    # "default"는 "full"의 alias (하위호환)
    if profile_name in (None, "default"):
        profile_name = "full"

    # "custom" → 사용자 지정 목록
    if profile_name == "custom":
        return project.get("conventions", {}).get("customSkills", [])

    # skill-profiles.json 로드
    profiles_config = load_json(".claude/skill-profiles.json")
    internal = profiles_config.get("internal", [])
    profile = profiles_config["profiles"].get(profile_name, profiles_config["profiles"]["full"])
    skills = profile.get("skills", "*")

    # 와일드카드: 전체 스킬 디렉토리 탐색 - internal 제외
    if skills == "*":
        all_skills = [d.name for d in Path(".claude/skills").iterdir()
                      if d.is_dir() and d.name.startswith("skill-")]
        return sorted([s for s in all_skills if s not in internal])

    return skills


def generate_skill_list_section(project: dict) -> str:
    """
    프로파일 기반 스킬 목록 (bash 코드블록) 생성.
    SKILL_REGISTRY에서 활성 스킬만 필터링하여 bash 코드블록을 구성한다.
    """
    active_skills = resolve_skill_profile(project)
    lines = ["```bash"]

    for skill_name, data in SKILL_REGISTRY.items():
        if skill_name in active_skills:
            for cmd in data["commands"]:
                lines.append(cmd)

    lines.append("```")
    return "\n".join(lines)
```

### NATURAL_LANGUAGE_COMMANDS (프로파일 기반 자연어 매핑)

```python
def generate_natural_language_commands(project: dict) -> str:
    """
    프로파일 기반 자연어 명령어 테이블 생성.
    SKILL_REGISTRY에서 활성 스킬의 nl_mappings만 필터링하여 마크다운 테이블을 구성한다.
    """
    active_skills = resolve_skill_profile(project)

    lines = [
        "| 자연어 | 스킬 | 동작 |",
        "|--------|------|------|",
    ]

    for skill_name, data in SKILL_REGISTRY.items():
        if skill_name in active_skills:
            for nl, cmd, action in data["nl_mappings"]:
                lines.append(f"| {nl} | {cmd} | {action} |")

    return "\n".join(lines)
```

### DOMAIN_ERROR_CODES (레이지 로딩 — 파일 경로 참조)

```python
def generate_error_codes_section(domain_id: str) -> str:
    """
    에러 코드 파일 경로 참조 생성
    전체 에러 코드 테이블을 인라인하지 않고 파일 경로만 안내한다.
    """
    error_codes_path = f".claude/domains/{domain_id}/error-codes/error-codes.json"

    if not os.path.exists(error_codes_path):
        return ""

    return "\n".join([
        "## 에러 코드 참조",
        "",
        f"에러 코드 추가/수정 시: `{error_codes_path}` 필수 참조 (Read 도구로 로드)",
        f"에러 핸들링 가이드: `.claude/domains/{domain_id}/docs/error-handling.md`",
    ])
```

### DOMAIN_COMPLIANCE

```python
def generate_compliance_section(domain_config: dict) -> str:
    """
    도메인 컴플라이언스 목록 생성
    """
    compliance = domain_config.get("compliance", [])

    if not compliance:
        return "해당 없음"

    return ", ".join(compliance)
```

---

## 커스텀 섹션 보존

도메인 전환 시 사용자가 추가한 커스텀 규칙을 보존합니다.

### 커스텀 섹션 마커

CLAUDE.md 템플릿에서 커스텀 섹션은 다음 마커로 구분됩니다:

```markdown
<!-- CUSTOM_SECTION_START -->
(사용자 커스텀 규칙)
<!-- CUSTOM_SECTION_END -->
```

### 커스텀 섹션 추출

```python
def extract_custom_section(existing_claude_md: str) -> str:
    """
    기존 CLAUDE.md에서 커스텀 섹션 추출

    Returns:
        커스텀 섹션 내용 (마커 제외), 없으면 빈 문자열
    """
    START_MARKER = "<!-- CUSTOM_SECTION_START -->"
    END_MARKER = "<!-- CUSTOM_SECTION_END -->"

    start_idx = existing_claude_md.find(START_MARKER)
    end_idx = existing_claude_md.find(END_MARKER)

    if start_idx == -1 or end_idx == -1:
        return ""

    # 마커 사이의 내용 추출 (마커 자체는 제외)
    content_start = start_idx + len(START_MARKER)
    custom_content = existing_claude_md[content_start:end_idx].strip()

    return custom_content
```

### 커스텀 섹션 보존하며 재생성

> ⚠️ **결정적 치환 원칙**: 기존 CLAUDE.md는 CUSTOM_SECTION 추출 용도로만 참조한다.
> 마커 외의 모든 텍스트는 **오직 템플릿(CLAUDE.md.tmpl)에서만** 생성한다.
> 기존 CLAUDE.md의 비-커스텀 내용을 복사하거나 참조해서는 안 된다.

```python
def generate_claude_md_with_preservation(
    project_json_path: str,
    existing_claude_md_path: str = "CLAUDE.md"
) -> str:
    """
    커스텀 섹션을 보존하며 CLAUDE.md 재생성

    ⚠️ 결정적 치환: 기존 CLAUDE.md는 CUSTOM_SECTION 추출에만 사용.
    나머지는 전적으로 템플릿에서 생성한다.

    Args:
        project_json_path: project.json 경로
        existing_claude_md_path: 기존 CLAUDE.md 경로 (CUSTOM_SECTION 추출 전용)

    Returns:
        생성된 CLAUDE.md 내용
    """
    # 1. 기존 CLAUDE.md에서 CUSTOM_SECTION만 추출 (이것만 참조)
    custom_section = ""
    if os.path.exists(existing_claude_md_path):
        with open(existing_claude_md_path, 'r', encoding='utf-8') as f:
            existing_content = f.read()
        custom_section = extract_custom_section(existing_content)

    # 2. 새 CLAUDE.md 생성 — 템플릿에서만 생성 (기존 CLAUDE.md 참조 금지)
    new_content = generate_claude_md(project_json_path)

    # 3. 커스텀 섹션 복원
    if custom_section:
        START_MARKER = "<!-- CUSTOM_SECTION_START -->"
        END_MARKER = "<!-- CUSTOM_SECTION_END -->"

        start_idx = new_content.find(START_MARKER)
        end_idx = new_content.find(END_MARKER)

        if start_idx != -1 and end_idx != -1:
            before = new_content[:start_idx + len(START_MARKER)]
            after = new_content[end_idx:]
            new_content = f"{before}\n{custom_section}\n{after}"

    return new_content
```

---

## 전체 처리 플로우

```python
def generate_claude_md(project_json_path: str) -> str:
    """
    CLAUDE.md 생성 메인 함수
    """
    # 1. 입력 파일 로드
    project = load_json(project_json_path)
    domain_id = project.get("domain", "general")
    domain = load_domain_json(domain_id)

    # 2. 템플릿 로드
    template = load_template(".claude/templates/CLAUDE.md.tmpl")

    # 3. 단순 마커 값 준비
    simple_values = {
        "PROJECT_NAME": project.get("name", "My Project"),
        "PROJECT_DESCRIPTION": project.get("description", ""),
        "DOMAIN_ID": domain_id,
        "DOMAIN_NAME": domain.get("name", "범용"),
        "DOMAIN_ICON": domain.get("icon", "🔧"),
        "TASK_PREFIX": resolve_task_prefix(project, domain),
        "PR_LINE_LIMIT": resolve_pr_line_limit(project, domain),
        "TEST_COVERAGE": resolve_test_coverage(project, domain),
        "WORKFLOW_PROFILE": project.get("conventions", {}).get("workflowProfile", "standard"),
        "SKILL_PROFILE": project.get("conventions", {}).get("skillProfile", "default"),
    }

    # 4. 블록 마커 값 준비
    block_values = {
        "TECH_STACK_SECTION": generate_tech_stack_section(project.get("techStack", {})),
        "AGENTS_SECTION": generate_agents_section(project.get("agents", {})),
        "CONVENTIONS_SECTION": generate_conventions_section(project, domain),  # 레이지 로딩 트리거 테이블
        "DOMAIN_DOCS_MAPPING": generate_docs_mapping(domain),
        "DOMAIN_ERROR_CODES": generate_error_codes_section(domain_id),  # 레이지 로딩 파일 참조
        "DOMAIN_COMPLIANCE": generate_compliance_section(domain),
        "WORKFLOW_CHAINING_RULES": generate_workflow_chaining_rules(project),  # 프로필별 체이닝 규칙
        "SKILL_LIST_SECTION": generate_skill_list_section(project),  # 프로파일별 스킬 목록
        "NATURAL_LANGUAGE_COMMANDS": generate_natural_language_commands(project),  # 프로파일별 자연어 매핑
        "CUSTOM_SECTION": "",  # 초기 생성 시 빈 값, 보존 시 extract_custom_section()으로 대체
    }

    # 5. 마커 치환
    result = template
    for marker, value in {**simple_values, **block_values}.items():
        result = result.replace(f"{{{{{marker}}}}}", str(value))

    return result
```

---

## 사용 시점

### 1. 프로젝트 초기화 (skill-init)

```
/skill-init
  ↓
대화형 설정 수집
  ↓
project.json 생성
  ↓
generate_claude_md() 호출
  ↓
CLAUDE.md 생성
```

### 2. 도메인 전환 (skill-domain switch)

```
/skill-domain switch ecommerce
  ↓
기존 CLAUDE.md에서 커스텀 섹션 추출
  ↓
project.json의 domain 필드 업데이트
  ↓
generate_claude_md() 호출
  ↓
CLAUDE.md 재생성 (커스텀 섹션 복원)
```

### 3. 설정 변경

```
project.json 수동 편집
  ↓
/skill-status (변경 감지)
  ↓
CLAUDE.md 재생성 제안
```

---

## 확장 포인트

### 커스텀 마커 추가

1. `TEMPLATE-ENGINE.md`에 마커 정의 추가
2. `CLAUDE.md.tmpl`에 마커 사용
3. 생성 함수 구현

### 도메인별 템플릿 오버라이드

```
.claude/domains/fintech/templates/CLAUDE.md.tmpl  # 도메인 전용 템플릿
.claude/templates/CLAUDE.md.tmpl                  # 기본 템플릿
```

도메인 템플릿이 있으면 우선 사용합니다.

### 코드 템플릿 스택 기반 자동 선택

코드 템플릿(`.tmpl`)은 백엔드 스택에 따라 자동 선택됩니다.

**파일 확장자 규칙:**
| 스택 | 확장자 | 예시 |
|------|--------|------|
| spring-boot-kotlin | `.kt.tmpl` | `state-machine.kt.tmpl` |
| spring-boot-java | `.java.tmpl` | `state-machine.java.tmpl` |
| nodejs-typescript | `.ts.tmpl` | `state-machine.ts.tmpl` |
| go | `.go.tmpl` | `state-machine.go.tmpl` |
| python-fastapi | `.py.tmpl` | `state-machine.py.tmpl` |
| python-django | `.py.tmpl` | `state-machine.py.tmpl` |
| none (프론트엔드 전용) | — | 코드 템플릿 불필요 |

**선택 로직:**
```python
def select_template(template_name: str, tech_stack: dict, domain: str) -> str:
    """
    스택 기반 템플릿 파일 선택

    1. project.json의 techStack.backend 확인
    2. 해당 확장자의 템플릿 파일 검색
    3. 없으면 .kt.tmpl 폴백 (기본)
    """
    backend = tech_stack.get("backend", "spring-boot-kotlin")

    # backend="none"이면 코드 템플릿 불필요 (프론트엔드 전용 프로젝트)
    if backend == "none":
        return None

    ext_map = {
        "spring-boot-kotlin": ".kt.tmpl",
        "spring-boot-java": ".java.tmpl",
        "nodejs-typescript": ".ts.tmpl",
        "go": ".go.tmpl",
        "python-fastapi": ".py.tmpl",
        "python-django": ".py.tmpl",
    }

    ext = ext_map.get(backend, ".kt.tmpl")
    template_path = f".claude/domains/{domain}/templates/{template_name}{ext}"

    if os.path.exists(template_path):
        return template_path

    # 폴백: Kotlin 템플릿
    fallback = f".claude/domains/{domain}/templates/{template_name}.kt.tmpl"
    return fallback if os.path.exists(fallback) else None
```

**사용 시점:**
- `skill-plan` — 설계 분석 시 관련 템플릿 참조
- `skill-impl` — 코드 생성 시 템플릿 기반 스캐폴딩

**현재 지원 현황:**
| 도메인 | `.kt.tmpl` | `.ts.tmpl` | `.java.tmpl` | `.go.tmpl` |
|--------|-----------|-----------|-------------|-----------|
| fintech | 5개 | 4개 | - | - |
| ecommerce | 3개 | 3개 | - | - |

### PR Body 템플릿

PR 생성 시 사용되는 body 템플릿입니다.

#### 파일 위치
```
.claude/templates/pr-body.md.tmpl                    # 기본 템플릿
.claude/domains/{domain}/templates/pr-body.md.tmpl   # 도메인 오버라이드
```

#### 마커 정의

| 마커 | 출처 | 기본값 | 설명 |
|------|------|--------|------|
| `{{TASK_TITLE}}` | 런타임 | "" | Task 제목 |
| `{{STEP_NUMBER}}` | 런타임 | "1" | 현재 스텝 번호 |
| `{{STEP_TOTAL}}` | 런타임 | "1" | 전체 스텝 수 |
| `{{CHANGES_LIST}}` | 런타임 (git diff) | "" | 변경 사항 목록 |

#### 사용 시점
- `skill-impl` → PR 생성 시 자동 로드

### 조건부 섹션

```markdown
{{#if HAS_FRONTEND}}
## 프론트엔드 가이드
...
{{/if}}
```

조건부 블록은 `{{#if CONDITION}}...{{/if}}` 형식으로 지원 예정입니다.

---

## 기본값 정의

```json
{
  "DEFAULTS": {
    "PROJECT_NAME": "My Project",
    "PROJECT_DESCRIPTION": "",
    "DOMAIN_ID": "general",
    "DOMAIN_NAME": "범용",
    "DOMAIN_ICON": "🔧",
    "TASK_PREFIX": "TASK",
    "PR_LINE_LIMIT": 500,
    "TEST_COVERAGE": 80,
    "BRANCH_STRATEGY": "git-flow",
    "COMMIT_FORMAT": "conventional"
  }
}
```

---

## 검증 규칙

### 필수 마커 검증

템플릿 처리 후 치환되지 않은 마커가 있으면 경고:

```
⚠️ 미치환 마커 발견: {{CUSTOM_MARKER}}
project.json 또는 domain.json에 해당 값을 추가하세요.
```

### 출력 검증

생성된 CLAUDE.md의 유효성 검증:

1. 마크다운 문법 검증
2. 코드 블록 닫힘 확인
3. 테이블 형식 확인
4. 빈 섹션 경고

### 재생성 정합성 검증 (upgrade 시)

템플릿 변경이 CLAUDE.md에 올바르게 반영됐는지 검증:

1. **포지티브 체크**: 새 템플릿의 비-마커 고유 문장 3개를 샘플 추출 → 재생성된 CLAUDE.md에서 존재 확인
2. **네거티브 체크**: 이전 버전 템플릿에만 있던 삭제 대상 문장이 잔존하는지 확인 (`CUSTOM_SECTION` 내부 제외)
3. **불일치 시**: 재생성 재시도 (최대 1회) — 템플릿만 참조, 기존 CLAUDE.md 참조 금지

---

## 관련 파일

| 파일 | 설명 |
|------|------|
| `.claude/templates/CLAUDE.md.tmpl` | 메인 템플릿 |
| `.claude/schemas/project.json` | project.json 스키마 |
| `.claude/domains/{domain}/domain.json` | 도메인 설정 |
| `.claude/domains/_base/conventions/` | 공통 컨벤션 |
