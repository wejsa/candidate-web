# Python 테스팅 컨벤션

pytest 중심의 Python 테스팅 규칙입니다.
테스트 피라미드, 구조, 네이밍은 `testing.md` 공통 원칙을 따릅니다.

## 테스트 프레임워크

| 용도 | 도구 |
|------|------|
| 단위/통합 테스트 | pytest + pytest-asyncio |
| HTTP 클라이언트 | httpx (AsyncClient) |
| 커버리지 | pytest-cov |
| 모킹 | unittest.mock / pytest-mock |
| DB 픽스처 | factory-boy (선택) |

## 디렉토리 구조

소스 디렉토리를 미러링합니다:

```
tests/
├── conftest.py             # 공용 fixtures
├── api/
│   └── test_{domain}.py    # API 통합 테스트
├── services/
│   └── test_{domain}_service.py  # 서비스 단위 테스트
└── repositories/
    └── test_{domain}_repository.py  # 레포지토리 테스트
```

## 네이밍

| 항목 | 규칙 | 예시 |
|------|------|------|
| 파일 | `test_{모듈명}.py` | `test_user_service.py` |
| 클래스 | `Test{대상}` | `TestUserService` |
| 함수 | `test_should_{행동}_when_{조건}` | `test_should_create_user_when_valid_data` |

## Fixture 패턴

### conftest.py 필수 fixture

```python
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from app.main import app
from app.core.database import get_db

@pytest.fixture
async def db_session():
    """테스트용 DB 세션 — 각 테스트 후 자동 롤백"""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with test_session() as session:
        yield session
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.fixture
async def client(db_session: AsyncSession):
    """테스트용 HTTP 클라이언트"""
    async def override_get_db():
        yield db_session
    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
```

### 도메인별 fixture

```python
@pytest.fixture
async def sample_user(db_session: AsyncSession) -> User:
    """테스트용 사용자 생성"""
    user = User(email="test@example.com", name="Test User")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user
```

## 테스트 구조 (Given/When/Then)

```python
class TestUserService:
    async def test_should_create_user_when_valid_data(self, db_session):
        # Given
        data = UserCreate(email="new@example.com", name="New")
        service = UserService(db_session)

        # When
        result = await service.create(data)

        # Then
        assert result.id is not None
        assert result.email == "new@example.com"

    async def test_should_raise_when_duplicate_email(self, db_session, sample_user):
        # Given
        data = UserCreate(email=sample_user.email, name="Dup")
        service = UserService(db_session)

        # When / Then
        with pytest.raises(DuplicateEmailError):
            await service.create(data)
```

## API 통합 테스트

```python
class TestUserAPI:
    async def test_should_return_user_when_exists(self, client, sample_user):
        # When
        response = await client.get(f"/api/v1/users/{sample_user.id}")

        # Then
        assert response.status_code == 200
        assert response.json()["email"] == sample_user.email

    async def test_should_return_404_when_not_found(self, client):
        response = await client.get("/api/v1/users/99999")
        assert response.status_code == 404
```

## 테스트 피라미드

| 유형 | 비율 | 대상 |
|------|------|------|
| 단위 | 70% | Service, Repository, 도메인 로직 |
| 통합 | 20% | API 엔드포인트 + DB |
| E2E | 10% | 시나리오 (주문→결제→완료) |

## 커버리지

```bash
# 실행
pytest --cov=app --cov-report=term-missing --cov-fail-under=80

# 특정 모듈만
pytest tests/services/ --cov=app/services
```

| 기준 | 목표 |
|------|------|
| 라인 커버리지 | 80%+ |
| 브랜치 커버리지 | 70%+ |
| 핵심 서비스 | 90%+ |

## pytest 설정

```toml
# pyproject.toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
python_files = "test_*.py"
python_classes = "Test*"
python_functions = "test_*"
addopts = "--strict-markers -v"
```

## 금지 패턴

| 금지 | 이유 | 대안 |
|------|------|------|
| `time.sleep()` 사용 | 테스트 느려짐 | `pytest-freezegun` 또는 mock |
| 외부 API 직접 호출 | 비결정적 | `httpx.MockTransport` 또는 `respx` |
| 테스트 간 상태 공유 | 순서 의존성 | fixture로 격리 |
| `print()` 디버깅 | CI에서 무의미 | `pytest -s` + logging |
