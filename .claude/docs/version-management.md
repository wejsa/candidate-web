# 버전 관리 가이드

AI Crew Kit의 버전 관리 시스템에 대한 가이드입니다.

## 버전 관리 구조

```
ai-crew-kit/
├── VERSION              # 현재 버전 (단순 텍스트)
├── CHANGELOG.md         # 상세 변경 이력
├── README.md            # 제목에 버전 표시
└── .claude/skills/
    └── skill-release/   # 릴리스 자동화 스킬
```

## 파일 설명

### VERSION
- **형식**: 단순 텍스트 (예: `1.1.0`)
- **규칙**: [Semantic Versioning](https://semver.org/) 준수
- **위치**: 프로젝트 루트

### CHANGELOG.md
- **형식**: [Keep a Changelog](https://keepachangelog.com/) 표준
- **카테고리**:
  - `Added`: 새로운 기능
  - `Changed`: 기존 기능 변경
  - `Fixed`: 버그 수정
  - `Removed`: 제거된 기능
  - `Deprecated`: 곧 제거될 기능
  - `Security`: 보안 관련

## Semantic Versioning

```
MAJOR.MINOR.PATCH (예: 1.2.3)
```

| 버전 | 변경 시점 | 예시 |
|------|----------|------|
| MAJOR | Breaking 변경 (하위 호환 X) | 1.0.0 → 2.0.0 |
| MINOR | 기능 추가 (하위 호환 O) | 1.0.0 → 1.1.0 |
| PATCH | 버그 수정 | 1.0.0 → 1.0.1 |

## 릴리스 워크플로우

### 자동화 방법 (권장)
```bash
# develop 브랜치에서 실행
/skill-release patch   # 버그 수정 릴리스
/skill-release minor   # 기능 추가 릴리스
/skill-release major   # Breaking 변경 릴리스
```

### 수동 방법
```bash
# 1. develop 브랜치에서 버전 업데이트
echo "1.2.0" > VERSION

# 2. CHANGELOG.md 업데이트 (새 버전 섹션 추가)

# 3. README.md 제목 버전 업데이트

# 4. 커밋
git add VERSION CHANGELOG.md README.md
git commit -m "chore: release v1.2.0"

# 5. main 머지
git checkout main
git merge develop

# 6. 태그 생성
git tag -a v1.2.0 -m "Release v1.2.0"

# 7. 푸시
git push origin develop main v1.2.0
```

## skill-release 상세

### 실행 조건
- develop 브랜치에서만 실행 가능
- 커밋되지 않은 변경사항이 없어야 함
- origin/develop과 동기화되어 있어야 함

### 자동 수행 작업
1. VERSION 파일 버전 범프
2. CHANGELOG.md에 새 버전 섹션 추가
3. README.md 제목 버전 업데이트
4. develop에 커밋
5. develop → main 머지
6. git tag 생성
7. 원격 푸시 (develop, main, tags)

### 변경사항 입력
실행 시 다음 카테고리별로 변경사항을 입력받습니다:
- Added (필수)
- Changed (선택)
- Fixed (선택)

## 롤백 방법

릴리스에 문제가 있을 경우:

```bash
# 태그 삭제
git tag -d v1.2.0
git push origin :refs/tags/v1.2.0

# main 브랜치 롤백
git checkout main
git reset --hard HEAD~1
git push origin main --force

# develop 브랜치 롤백
git checkout develop
git reset --hard HEAD~1
git push origin develop --force
```

## Best Practices

1. **릴리스 전 테스트**: develop에서 충분히 테스트 후 릴리스
2. **의미 있는 변경사항**: CHANGELOG에 사용자 관점의 변경사항 기록
3. **일관된 버전 관리**: Semantic Versioning 규칙 준수
4. **태그 활용**: GitHub Releases와 연동하여 릴리스 노트 자동 생성

## 관련 링크

- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [skill-release 스킬](./../skills/skill-release/SKILL.md)
