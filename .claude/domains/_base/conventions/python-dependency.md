# Python 의존성 관리 컨벤션

Python 프로젝트의 의존성, 환경, 빌드 관리 규칙입니다.

## 프로젝트 메타데이터

`pyproject.toml`을 표준으로 사용합니다. `setup.py` 단독 사용은 금지합니다.

```toml
[project]
name = "my-service"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0,<1.0.0",
    "uvicorn[standard]>=0.32.0",
    "sqlalchemy>=2.0.0,<3.0.0",
    "pydantic>=2.0.0,<3.0.0",
    "pydantic-settings>=2.0.0",
    "alembic>=1.14.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "pytest-cov>=6.0.0",
    "httpx>=0.28.0",
    "ruff>=0.8.0",
    "mypy>=1.13.0",
]
```

## 의존성 규칙

| 규칙 | 설명 |
|------|------|
| 버전 범위 고정 필수 | `fastapi>=0.115.0,<1.0.0` (unpinned 금지) |
| lock 파일 커밋 | `poetry.lock` 또는 `requirements.lock` |
| dev 의존성 분리 | `[project.optional-dependencies]` 사용 |
| Python 버전 명시 | `requires-python = ">=3.11"` |
| 최소 버전 유지 | 보안 패치가 포함된 최신 마이너 |

## 패키지 매니저

### 자동 감지 우선순위

| 파일 | 매니저 | 빌드 명령 | 테스트 명령 |
|------|--------|----------|-----------|
| `poetry.lock` | poetry | `poetry install` | `poetry run pytest` |
| `Pipfile.lock` | pipenv | `pipenv install` | `pipenv run pytest` |
| `requirements.txt` | pip | `pip install -r requirements.txt` | `pytest` |
| `pyproject.toml` (단독) | pip | `pip install -e ".[dev]"` | `pytest` |

### Poetry (권장)

```toml
# pyproject.toml
[tool.poetry]
name = "my-service"
version = "0.1.0"
python = "^3.11"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.115.0"
uvicorn = {extras = ["standard"], version = "^0.32.0"}
sqlalchemy = "^2.0.0"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0.0"
ruff = "^0.8.0"
```

## 가상환경

| 규칙 | 설명 |
|------|------|
| 가상환경 필수 | 시스템 Python에 직접 설치 금지 |
| `.venv/` 위치 | 프로젝트 루트 (gitignore에 추가) |
| 활성화 | `source .venv/bin/activate` 또는 `poetry shell` |

## 린트/포매터

```toml
# pyproject.toml
[tool.ruff]
target-version = "py311"
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "W", "I", "N", "UP", "B", "A", "S"]

[tool.mypy]
python_version = "3.11"
strict = true
plugins = ["pydantic.mypy"]
```

| 도구 | 용도 | 명령 |
|------|------|------|
| ruff | 린트 + 포맷 | `ruff check .` / `ruff format .` |
| mypy | 타입 체크 | `mypy app/` |

## DB 마이그레이션

### FastAPI — Alembic

```bash
# 마이그레이션 생성
alembic revision --autogenerate -m "add users table"

# 적용
alembic upgrade head

# 롤백
alembic downgrade -1
```

| 규칙 | 설명 |
|------|------|
| autogenerate 사용 | 모델 변경 자동 감지 |
| 마이그레이션 커밋 필수 | `alembic/versions/` Git 관리 |
| 하위 호환 | 롤백 가능한 마이그레이션만 작성 |
| 데이터 마이그레이션 분리 | 스키마와 데이터 변경을 별도 revision으로 |

### Django — manage.py

```bash
python manage.py makemigrations
python manage.py migrate
```

| 규칙 | 설명 |
|------|------|
| migration 파일 커밋 필수 | `{app}/migrations/` Git 관리 |
| squash 주기적 | 마이그레이션 파일이 20개 이상이면 squash 검토 |

## 빌드/테스트/린트 명령어 표준

### python-fastapi

```json
{
  "buildCommands": ["pip install -e '.[dev]'"],
  "testCommands": ["pytest --cov=app --cov-report=term-missing"],
  "lintCommands": ["ruff check .", "mypy app/"]
}
```

### python-django

```json
{
  "buildCommands": ["pip install -e '.[dev]'", "python manage.py check"],
  "testCommands": ["pytest --cov --cov-report=term-missing"],
  "lintCommands": ["ruff check .", "mypy ."]
}
```
