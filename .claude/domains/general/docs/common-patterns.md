# 범용 개발 패턴 가이드

## CRUD 패턴

### 기본 구조
```
Controller → Service → Repository → Database
    ↓           ↓          ↓
  DTO 변환   비즈니스 로직  데이터 접근
```

### API 엔드포인트 규칙
| 작업 | HTTP 메서드 | 경로 | 응답 코드 |
|------|-----------|------|----------|
| 목록 조회 | GET | `/api/v1/{resource}` | 200 |
| 단건 조회 | GET | `/api/v1/{resource}/{id}` | 200 / 404 |
| 생성 | POST | `/api/v1/{resource}` | 201 |
| 수정 | PUT | `/api/v1/{resource}/{id}` | 200 / 404 |
| 부분 수정 | PATCH | `/api/v1/{resource}/{id}` | 200 / 404 |
| 삭제 | DELETE | `/api/v1/{resource}/{id}` | 204 / 404 |

### 페이지네이션
- 커서 기반 권장 (대용량 데이터 시)
- 오프셋 기반 허용 (소규모 데이터)
- 응답에 `totalCount`, `hasNext`, `cursor` 포함

```json
{
  "data": [...],
  "pagination": {
    "totalCount": 100,
    "pageSize": 20,
    "hasNext": true,
    "cursor": "eyJpZCI6MTAwfQ=="
  }
}
```

## 인증/인가 패턴

### JWT 기반 인증
1. 로그인 → Access Token + Refresh Token 발급
2. API 호출 → `Authorization: Bearer {accessToken}`
3. 만료 → Refresh Token으로 갱신
4. Access Token: 15~30분, Refresh Token: 7~30일

### 권한 검사 순서
```
1. 토큰 유효성 (만료, 서명)
2. 사용자 활성 상태
3. 리소스 접근 권한
4. 비즈니스 규칙
```

### 비밀번호 정책
- 최소 8자, 대소문자 + 숫자 + 특수문자
- bcrypt (cost factor 12+) 또는 argon2id
- 평문 저장 절대 금지

## 에러 처리 패턴

### 표준 에러 응답
```json
{
  "error": {
    "code": "ERR-001",
    "message": "사용자를 찾을 수 없습니다",
    "details": {
      "field": "userId",
      "value": "123"
    }
  }
}
```

### 에러 코드 체계
| 범위 | 분류 |
|------|------|
| ERR-0xx | 공통 에러 (인증, 권한, 유효성) |
| ERR-1xx | 비즈니스 로직 에러 |
| ERR-2xx | 외부 서비스 에러 |
| ERR-9xx | 시스템 에러 |

### HTTP 상태 코드 매핑
| 상태 코드 | 사용 상황 |
|----------|----------|
| 400 | 요청 유효성 실패 |
| 401 | 인증 실패 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌 (중복 등) |
| 422 | 비즈니스 규칙 위반 |
| 500 | 서버 내부 오류 |
| 502/503 | 외부 서비스 오류 |

## 테스트 패턴

### 테스트 피라미드
```
        ╱  E2E  ╲        (소수, 핵심 시나리오만)
       ╱ 통합 테스트 ╲     (API, DB 연동)
      ╱   단위 테스트   ╲   (비즈니스 로직 집중)
```

### 테스트 네이밍 규칙
```
[메서드명]_[시나리오]_[기대결과]
예: createUser_duplicateEmail_throwsConflictException
```

### 테스트 데이터
- 팩토리 패턴으로 테스트 데이터 생성
- 테스트 간 데이터 격리 (트랜잭션 롤백 또는 독립 DB)
- 외부 서비스는 mock/stub 사용

## 데이터베이스 패턴

### 마이그레이션
- 스키마 변경은 반드시 마이그레이션 스크립트로 관리
- 되돌리기(rollback) 스크립트 필수
- 운영 데이터 직접 수정 금지

### 인덱스 전략
- WHERE 절 빈번 컬럼에 인덱스
- 복합 인덱스: 선택도 높은 컬럼 앞에
- 불필요한 인덱스 정기 정리

### Soft Delete
- `deletedAt` 컬럼으로 논리 삭제
- 기본 쿼리에 `WHERE deletedAt IS NULL` 조건
- 데이터 보존 기간 정책 수립
