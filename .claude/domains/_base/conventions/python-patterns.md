# Python 관용 패턴 컨벤션

Python 프로젝트에서 자주 사용되는 패턴과 안티패턴입니다.

## Pydantic 스키마 분리

용도별로 스키마를 분리합니다. 하나의 모델로 CRUD 전체를 처리하면 안 됩니다.

```python
# ✅ 올바른 패턴
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class UserUpdate(BaseModel):
    name: str | None = None
    email: EmailStr | None = None

# ❌ 금지 — 응답에 비밀번호 포함 위험
class User(BaseModel):
    id: int | None = None
    password: str | None = None
```

| 스키마 | 용도 | 필수 필드 |
|--------|------|----------|
| `{Domain}Create` | 생성 요청 | 모든 필수 필드 |
| `{Domain}Response` | 응답 | id + 공개 필드, `from_attributes=True` |
| `{Domain}Update` | 수정 요청 | 모든 필드 Optional |
| `{Domain}List` | 목록 응답 (선택) | items + pagination |

## FastAPI 의존성 주입

```python
# ✅ 올바른 패턴 — Depends 활용
@router.get("/users/me")
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await user_service.get(db, current_user.id)

# ❌ 금지 — 모듈 레벨 인스턴스
db = get_database()  # 전역 상태
```

| 규칙 | 설명 |
|------|------|
| DB 세션은 Depends로 | 요청 스코프 보장 |
| 인증은 Depends로 | 재사용 가능한 의존성 체인 |
| 서비스는 함수 내 생성 또는 Depends | 전역 인스턴스 금지 |

## 비동기 패턴

### async/sync 일관성

하나의 모듈에서 async와 sync를 혼용하지 않습니다.

```python
# ✅ async 일관
async def get_user(db: AsyncSession, user_id: int) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()

# ❌ async 라우터에서 sync DB 호출 — 이벤트 루프 블로킹
@router.get("/users/{user_id}")
async def get_user_endpoint(user_id: int):
    user = db.query(User).get(user_id)  # 블로킹!
```

### CPU 바운드 작업

```python
# ✅ run_in_executor로 블로킹 회피
import asyncio

async def process_image(image_data: bytes) -> bytes:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_process, image_data)
```

## SQLAlchemy 세션 관리

```python
# ✅ 올바른 패턴 — context manager
async with async_session() as session:
    async with session.begin():
        session.add(user)
    # 자동 commit, 실패 시 자동 rollback

# ❌ 금지 — 수동 관리 (누수 위험)
session = async_session()
session.add(user)
await session.commit()
# session.close() 빠뜨리면 커넥션 누수
```

| 규칙 | 설명 |
|------|------|
| context manager 필수 | `async with session:` 패턴 |
| 트랜잭션 명시 | `session.begin()` 사용 |
| N+1 방지 | `selectinload()` / `joinedload()` 사용 |
| bulk 연산 | 100건 이상은 `bulk_save_objects` 또는 `insert().values()` |

## 환경 설정

```python
# ✅ pydantic-settings 사용
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    debug: bool = False
    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()

# ❌ 금지 — os.environ 직접 접근
import os
db_url = os.environ["DATABASE_URL"]  # 타입 검증 없음, 기본값 없음
```

## 예외 처리

```python
# 커스텀 예외 정의
class AppException(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code

class NotFoundError(AppException):
    def __init__(self, resource: str, id: Any):
        super().__init__(
            code="NOT_FOUND",
            message=f"{resource} not found: {id}",
            status_code=404,
        )

# 전역 핸들러 등록
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )
```

| 규칙 | 설명 |
|------|------|
| 커스텀 예외 계층 | `AppException` → 하위 예외 |
| 전역 핸들러 필수 | 커스텀 예외 → JSON 응답 변환 |
| HTTP 예외 직접 raise 금지 | 서비스 레이어에서 `HTTPException` 사용 금지 |
| 로깅 포함 | 500 에러는 스택트레이스 로깅 |

## 보안 패턴

```python
# 비밀번호 해싱
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)
```

| 규칙 | 설명 |
|------|------|
| bcrypt/argon2 사용 | 평문 저장 절대 금지 |
| JWT 비밀키 환경변수 | 코드에 하드코딩 금지 |
| CORS 명시적 설정 | `allow_origins=["*"]` 프로덕션 금지 |
| SQL 파라미터 바인딩 | raw SQL 시 `text()` + `bindparams` 필수 |
