# 프로젝트 구조 컨벤션

모든 프로젝트에 적용되는 프로젝트 구조 규칙입니다.
도메인별 모듈 구성은 해당 도메인 문서를 참조하세요.

## 레이어 아키텍처 원칙

```
Controller (API) → Service (Application) → Repository (Infrastructure)
                        ↓
                   Domain (Entity, VO)
```

| 원칙 | 설명 |
|------|------|
| 단방향 의존성 | 상위 레이어 → 하위 레이어만 참조 |
| Domain 독립성 | Domain 레이어는 다른 레이어에 의존하지 않음 |
| Interface 분리 | Repository Interface는 Domain에, 구현은 Infrastructure에 |
| 관심사 분리 | 각 레이어는 자신의 책임만 수행 |

### 레이어별 책임

| 레이어 | 책임 | 포함 요소 |
|--------|------|----------|
| API | HTTP 요청/응답 처리 | Controller, DTO, Advice |
| Application | 유즈케이스 로직 | Service, UseCase, Port |
| Domain | 핵심 비즈니스 규칙 | Entity, VO, Repository Interface, Enum |
| Infrastructure | 외부 시스템 연동 | Repository Impl, External Client, Config |

## 스택별 패키지 구조

> **Python 프로젝트**: `python-project-structure.md` 참조 (FastAPI, Django 전용 구조)

### Spring Boot (Kotlin/Java)

```
src/main/kotlin/com/{company}/{project}/
├── api/                    # Controller, DTO, GlobalExceptionHandler
│   ├── {도메인}/
│   │   ├── {Domain}Controller.kt
│   │   ├── {Action}{Domain}Request.kt
│   │   └── {Domain}Response.kt
│   └── GlobalExceptionHandler.kt
├── application/            # Service, UseCase
│   └── {도메인}/
│       └── {Domain}Service.kt
├── domain/                 # Entity, Repository Interface, Enum
│   └── {도메인}/
│       ├── {Domain}.kt
│       ├── {Domain}Repository.kt
│       └── {Domain}Status.kt
├── infrastructure/         # Repository Impl, External Client
│   ├── persistence/
│   │   └── {Domain}JpaRepository.kt
│   └── external/
│       └── {External}Client.kt
└── config/                 # Configuration
    ├── SecurityConfig.kt
    ├── WebConfig.kt
    └── DataSourceConfig.kt
```

### Node.js (TypeScript)

```
src/
├── controllers/            # Route handlers
│   └── {domain}.controller.ts
├── services/               # Business logic
│   └── {domain}.service.ts
├── models/                 # Data models (Entity, DTO)
│   ├── {domain}.entity.ts
│   └── {domain}.dto.ts
├── repositories/           # Data access
│   └── {domain}.repository.ts
├── middlewares/             # Express/Koa middlewares
│   ├── auth.middleware.ts
│   ├── error.middleware.ts
│   └── validation.middleware.ts
├── config/                 # Configuration
│   ├── database.ts
│   └── env.ts
├── routes/                 # Route definitions
│   └── {domain}.routes.ts
├── utils/                  # Utility functions
│   └── logger.ts
└── app.ts                  # Application entry point
```

### Go

```
cmd/
└── server/                 # Main entry point
    └── main.go
internal/
├── handler/                # HTTP handlers
│   └── {domain}_handler.go
├── service/                # Business logic
│   └── {domain}_service.go
├── repository/             # Data access
│   └── {domain}_repository.go
├── model/                  # Domain models
│   ├── {domain}.go
│   └── {domain}_dto.go
├── config/                 # Configuration
│   └── config.go
└── middleware/              # HTTP middlewares
    ├── auth.go
    └── logger.go
pkg/                        # Public packages (외부 사용 가능)
└── {shared}/
```

### Python (FastAPI / Django)

> 상세 구조는 `python-project-structure.md` 참조

**FastAPI**:
```
app/
├── main.py           # FastAPI 인스턴스
├── api/              # Router (엔드포인트)
├── services/         # Business logic
├── models/           # SQLAlchemy 모델
├── schemas/          # Pydantic DTO
├── repositories/     # Data access
└── core/             # DB, Security, Exceptions
```

**Django (DRF)**:
```
config/               # 프로젝트 설정
apps/{domain}/
├── views.py          # APIView / ViewSet (얇게)
├── services.py       # 비즈니스 로직
├── models.py         # Django ORM
├── serializers.py    # DRF 시리얼라이저
└── repositories.py   # 복잡한 쿼리
```

## 공통 디렉토리

스택에 관계없이 존재하는 공통 디렉토리:

| 디렉토리 | 용도 |
|----------|------|
| `config/` | 애플리케이션 설정 (DB, 보안, 캐시 등) |
| `common/` 또는 `shared/` | 공통 유틸리티, 상수 |
| `exception/` 또는 `error/` | 커스텀 예외/에러 정의 |

## 모듈 분리 기준

프로젝트 규모에 따라 패키지/모듈 분리 방식을 선택합니다:

| 규모 | 분리 방식 | 예시 |
|------|----------|------|
| 소규모 | 레이어 기준 | `controllers/`, `services/`, `models/` |
| 중규모 | 도메인 기준 (권장) | `payment/`, `user/`, `order/` |
| 대규모 | 모듈(멀티 프로젝트) | `payment-module/`, `user-module/` |

### 도메인 기준 분리 예시 (권장)

```
src/main/kotlin/com/{company}/{project}/
├── payment/
│   ├── api/
│   ├── application/
│   ├── domain/
│   └── infrastructure/
├── user/
│   ├── api/
│   ├── application/
│   ├── domain/
│   └── infrastructure/
└── order/
    ├── api/
    ├── application/
    ├── domain/
    └── infrastructure/
```

## 테스트 디렉토리

소스 디렉토리와 동일한 패키지 구조를 미러링합니다:

```
src/
├── main/kotlin/com/{company}/{project}/
│   └── payment/
│       ├── api/PaymentController.kt
│       ├── application/PaymentService.kt
│       └── domain/Payment.kt
└── test/kotlin/com/{company}/{project}/
    └── payment/
        ├── api/PaymentControllerTest.kt
        ├── application/PaymentServiceTest.kt
        └── domain/PaymentTest.kt
```

| 테스트 유형 | 위치 | 네이밍 |
|------------|------|--------|
| 단위 테스트 | 소스와 동일 패키지 | `{Class}Test` |
| 통합 테스트 | 별도 패키지 또는 태그 | `{Class}IntegrationTest` |
| E2E 테스트 | `e2e/` 또는 별도 모듈 | `{Scenario}E2ETest` |
