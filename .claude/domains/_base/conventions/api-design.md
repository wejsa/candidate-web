# API 설계 컨벤션

모든 프로젝트에 적용되는 RESTful API 설계 규칙입니다.
도메인별 확장(웹훅, PG 연동 등)은 해당 도메인 문서를 참조하세요.

## URL 구조

| 규칙 | 예시 |
|------|------|
| 복수형 리소스 | `/api/v1/users`, `/api/v1/payments` |
| kebab-case | `/api/v1/payment-methods` |
| 계층 관계 | `/api/v1/users/{userId}/orders` |
| 버전 포함 | `/api/v1/`, `/api/v2/` |
| 동사 금지 | ~~`/api/v1/getUsers`~~ → `/api/v1/users` |

```
GET    /api/v1/{resources}
GET    /api/v1/{resources}/{id}
POST   /api/v1/{resources}
PUT    /api/v1/{resources}/{id}
PATCH  /api/v1/{resources}/{id}
DELETE /api/v1/{resources}/{id}
```

## HTTP 메서드

| 메서드 | 용도 | 멱등성 | 요청 본문 |
|--------|------|--------|----------|
| GET | 리소스 조회 | ✅ | 없음 |
| POST | 리소스 생성 | ❌ | 있음 |
| PUT | 리소스 전체 수정 | ✅ | 있음 |
| PATCH | 리소스 부분 수정 | ✅ | 있음 |
| DELETE | 리소스 삭제 | ✅ | 없음 |

## 상태 코드

| 코드 | 의미 | 사용 시점 |
|------|------|----------|
| 200 | OK | 조회/수정 성공 |
| 201 | Created | 생성 성공 |
| 204 | No Content | 삭제 성공 |
| 400 | Bad Request | 잘못된 요청 (검증 실패) |
| 401 | Unauthorized | 인증 필요 |
| 403 | Forbidden | 권한 없음 |
| 404 | Not Found | 리소스 없음 |
| 409 | Conflict | 리소스 충돌 (중복 등) |
| 422 | Unprocessable Entity | 비즈니스 규칙 위반 |
| 429 | Too Many Requests | 요청 한도 초과 |
| 500 | Internal Server Error | 서버 오류 |

## 공통 에러 응답 포맷

```json
{
  "code": "AUTH-001",
  "message": "인증 토큰이 만료되었습니다",
  "detail": "Access token expired at 2026-01-15T10:30:00Z",
  "traceId": "abc-123-def",
  "timestamp": "2026-01-15T10:30:05Z"
}
```

| 필드 | 설명 | 필수 |
|------|------|------|
| code | 에러 코드 (`{PREFIX}-{DOMAIN}-{NUMBER}`) | ✅ |
| message | 사용자 표시용 메시지 | ✅ |
| detail | 개발자용 상세 정보 (운영 환경 비노출) | ❌ |
| traceId | 요청 추적 ID | ✅ |
| timestamp | 에러 발생 시각 (ISO 8601) | ✅ |

## 페이지네이션

**Cursor-based (권장)**:
```
GET /api/v1/users?cursor={lastId}&size=20

{
  "data": [...],
  "cursor": {
    "next": "eyJpZCI6MTAwfQ==",
    "hasMore": true
  }
}
```

**Offset-based (단순 조회용)**:
```
GET /api/v1/users?page=0&size=20

{
  "data": [...],
  "page": {
    "number": 0,
    "size": 20,
    "totalElements": 150,
    "totalPages": 8
  }
}
```

## 요청/응답 네이밍

| 항목 | 규칙 | 예시 |
|------|------|------|
| JSON 필드 | camelCase | `userId`, `createdAt` |
| 쿼리 파라미터 | camelCase | `?pageSize=20&sortBy=createdAt` |
| 헤더 | 표준 헤더 또는 `X-` 접두사 | `Authorization`, `X-Request-Id` |

## API 버전 관리

| 방식 | 예시 | 권장 |
|------|------|------|
| URL path | `/api/v1/users` | ✅ 권장 |
| Header | `Accept: application/vnd.api.v1+json` | ❌ |

- 하위 호환성 유지가 불가능한 변경 시에만 버전 증가
- 기존 버전은 최소 6개월 유지 후 폐기

## 멱등성

외부 시스템 연동 및 결제 등 중복 실행 위험이 있는 API에 적용:

```
POST /api/v1/payments
Idempotency-Key: {client-generated-uuid}
```

| 항목 | 규칙 |
|------|------|
| 헤더 | `Idempotency-Key` |
| 값 | 클라이언트 생성 UUID |
| 유효기간 | 24시간 (기본) |
| 중복 요청 응답 | 최초 응답과 동일한 결과 반환 |

## Rate Limiting

응답 헤더에 현재 한도 상태를 포함:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706180400
```

429 응답 시 `Retry-After` 헤더 포함:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```
