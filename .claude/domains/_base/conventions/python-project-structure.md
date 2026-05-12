# Python 프로젝트 구조 컨벤션

Python 프로젝트에 적용되는 구조 규칙입니다.
레이어 아키텍처 원칙은 `project-structure.md`와 동일하며, Python 생태계에 맞게 매핑합니다.

## FastAPI

```
project-root/
├── pyproject.toml
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI 인스턴스, 미들웨어, 라우터 등록
│   ├── config.py               # pydantic-settings 기반 설정
│   ├── api/                    # Controller 레이어
│   │   ├── __init__.py
│   │   ├── deps.py             # 공용 의존성 (get_db, get_current_user)
│   │   └── v1/
│   │       ├── __init__.py
│   │       ├── router.py       # APIRouter 집합
│   │       └── {domain}.py     # 도메인별 엔드포인트
│   ├── services/               # Application 레이어
│   │   ├── __init__.py
│   │   └── {domain}_service.py
│   ├── models/                 # Domain 레이어 (SQLAlchemy 모델)
│   │   ├── __init__.py
│   │   └── {domain}.py
│   ├── schemas/                # Pydantic DTO
│   │   ├── __init__.py
│   │   └── {domain}.py         # {Domain}Create, {Domain}Response, {Domain}Update
│   ├── repositories/           # Infrastructure 레이어
│   │   ├── __init__.py
│   │   ├── base.py             # BaseRepository (CRUD 공용)
│   │   └── {domain}_repository.py
│   └── core/                   # 공통 인프라
│       ├── __init__.py
│       ├── database.py         # SQLAlchemy 엔진, 세션 팩토리
│       ├── security.py         # JWT, 비밀번호 해싱
│       └── exceptions.py       # 커스텀 예외 + 핸들러
├── alembic/                    # DB 마이그레이션
│   ├── alembic.ini
│   ├── env.py
│   └── versions/
├── tests/                      # 소스 구조 미러링
│   ├── conftest.py
│   ├── api/
│   ├── services/
│   └── repositories/
├── Dockerfile
└── docker-compose.yml
```

### FastAPI 레이어 의존성

```
api/ → services/ → repositories/ → models/
         ↓
      schemas/ (DTO 변환)
         ↓
      core/ (인프라)
```

| 규칙 | 설명 |
|------|------|
| api/ → services/ 만 의존 | repositories 직접 접근 금지 |
| models/ 독립 | 다른 레이어 import 금지 |
| schemas/ 독립 | Pydantic 모델, 도메인 규칙 포함 가능 |
| core/ 는 공유 인프라 | 모든 레이어에서 참조 가능 |

### FastAPI 핵심 파일

**main.py** — 앱 인스턴스 + 미들웨어 + 라우터 등록만. 비즈니스 로직 금지.

**config.py** — `pydantic-settings` 기반 환경 설정:
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    redis_url: str = "redis://localhost:6379"
    jwt_secret: str
    model_config = SettingsConfigDict(env_file=".env")
```

**deps.py** — FastAPI `Depends` 공용 의존성:
```python
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    ...
```

## Django (DRF)

```
project-root/
├── pyproject.toml
├── manage.py
├── config/                     # 프로젝트 설정
│   ├── __init__.py
│   ├── settings/
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── local.py
│   │   └── production.py
│   ├── urls.py
│   └── wsgi.py
├── apps/                       # Django 앱
│   └── {domain}/
│       ├── __init__.py
│       ├── models.py           # Django ORM 모델
│       ├── serializers.py      # DRF 시리얼라이저
│       ├── views.py            # APIView / ViewSet
│       ├── services.py         # 비즈니스 로직
│       ├── repositories.py     # 복잡한 쿼리 캡슐화
│       ├── urls.py             # 앱별 URL
│       ├── admin.py
│       └── tests/
│           ├── __init__.py
│           ├── test_views.py
│           ├── test_services.py
│           └── test_models.py
├── common/                     # 공용 유틸
│   ├── __init__.py
│   ├── exceptions.py
│   ├── permissions.py
│   └── pagination.py
└── Dockerfile
```

### Django 앱 내부 레이어

```
views.py (Controller) → services.py → repositories.py → models.py
                              ↓
                        serializers.py (DTO)
```

| 규칙 | 설명 |
|------|------|
| views.py는 얇게 | 요청 파싱 + 시리얼라이저 검증 + 서비스 호출 + 응답만 |
| 비즈니스 로직은 services.py | views.py에 직접 작성 금지 |
| 복잡한 쿼리는 repositories.py | Manager/QuerySet 커스텀 |
| 앱 간 참조 최소화 | 앱 간 import는 services 레이어에서만 |

## 공통 규칙

| 항목 | 규칙 |
|------|------|
| 패키지 | 모든 디렉토리에 `__init__.py` 필수 |
| 네이밍 | 파일: snake_case, 클래스: PascalCase, 변수/함수: snake_case |
| import 순서 | stdlib → 서드파티 → 로컬 (isort 적용) |
| 타입 힌트 | 함수 시그니처에 필수 |
| docstring | public 클래스/함수에 권장 |
