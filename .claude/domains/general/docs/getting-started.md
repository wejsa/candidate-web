# 시작 가이드

AI Crew Kit을 사용한 프로젝트 개발 시작 가이드입니다.

## 1. 프로젝트 초기화

### skill-init 실행

```bash
/skill-init
```

대화형으로 다음을 설정합니다:
1. 프로젝트 이름
2. 도메인 선택 (general)
3. 기술 스택 선택
4. 에이전트 팀 구성

### 생성되는 파일

```
your-project/
├── .claude/
│   └── state/
│       ├── project.json      # 프로젝트 설정
│       └── backlog.json      # 백로그 (초기 빈 상태)
├── CLAUDE.md                  # AI 지시문
└── .gitignore
```

## 2. 기능 기획

### 새 기능 추가

```bash
/skill-feature "사용자 인증 기능"
```

또는 자연어로:

```
"사용자 인증 기능 기획해줘"
```

### 결과물

- 요구사항 문서 생성: `docs/requirements/{taskId}-spec.md`
- 백로그에 Task 등록: `.claude/state/backlog.json`

## 3. 설계 및 계획

### skill-plan 실행

```bash
/skill-plan
```

또는:

```
"다음 작업 가져와줘"
```

### 결과물

- 설계 문서 생성
- 스텝별 개발 계획 수립
- 계획 파일: `.claude/temp/{taskId}-plan.md`

## 4. 구현

### 스텝별 개발

```bash
/skill-impl              # Step 1 시작
/skill-impl --next       # 다음 스텝
/skill-impl --all        # 전체 스텝 연속
```

또는:

```
"개발 진행해줘"
"다음 스텝 진행해줘"
```

### 결과물

- 코드 구현
- 테스트 코드
- PR 자동 생성

## 5. 코드 리뷰

### PR 리뷰

```bash
/skill-review-pr 123
```

또는:

```
"PR 123 리뷰해줘"
```

### 5관점 통합 리뷰

| 관점 | 체크 항목 |
|------|----------|
| 컴플라이언스 | 규정 준수 |
| 도메인 | 비즈니스 로직 |
| 아키텍처 | 설계 패턴 |
| 보안 | 보안 취약점 |
| 테스트 | 테스트 품질 |

## 6. 머지

### PR 머지

```bash
/skill-merge-pr 123
```

또는:

```
"PR 123 머지해줘"
```

### 자동 처리

- Squash 머지
- 브랜치 삭제
- 상태 업데이트
- 다음 스텝 안내

## 워크플로우 요약

```
/skill-feature "기능명"     # 1. 기획
    ↓
/skill-plan                 # 2. 설계 + 계획
    ↓
/skill-impl                 # 3. 구현 (Step 1)
    ↓
/skill-review-pr N          # 4. 리뷰
    ↓
/skill-merge-pr N           # 5. 머지
    ↓
/skill-impl --next          # 6. 다음 스텝 (반복)
```

## 자주 사용하는 명령어

| 명령어 | 설명 |
|--------|------|
| `/skill-status` | 현재 상태 확인 |
| `/skill-backlog` | 백로그 조회 |
| `/skill-docs` | 참고자료 조회 |
| `/skill-review {경로}` | 코드 리뷰 (PR 외) |

## 자연어 명령어

| 말하기 | 동작 |
|--------|------|
| "상태 확인해줘" | `/skill-status` |
| "새 기능 기획해줘: 로그인" | `/skill-feature 로그인` |
| "다음 작업 가져와줘" | `/skill-plan` |
| "개발 진행해줘" | `/skill-impl` |
| "PR 리뷰해줘" | `/skill-review-pr` |

## 도움말

더 많은 정보는 다음을 참조하세요:

```bash
/skill-status    # 현재 상태 및 다음 단계 안내
/skill-docs      # 참고자료 목록
```
