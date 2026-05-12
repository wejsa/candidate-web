# 네이밍 컨벤션

모든 프로젝트에 적용되는 기본 네이밍 규칙입니다.
기술 스택별 세부 규칙은 해당 컨벤션 문서를 참조하세요.

## 일반 원칙

| 원칙 | 설명 |
|------|------|
| 의미 전달 | 이름만으로 용도를 알 수 있어야 함 |
| 일관성 | 프로젝트 전체에서 동일한 규칙 적용 |
| 약어 최소화 | 널리 알려진 약어만 사용 (ID, URL, HTTP 등) |
| 검색 가능성 | 검색하기 쉬운 이름 사용 |

## 케이스 스타일

| 스타일 | 예시 | 용도 |
|--------|------|------|
| PascalCase | `UserService`, `PaymentController` | 클래스, 인터페이스, 타입 |
| camelCase | `getUserById`, `totalAmount` | 변수, 함수, 메서드 |
| SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT`, `API_VERSION` | 상수 |
| kebab-case | `user-service`, `payment-api` | 파일명, URL 경로 |
| snake_case | `user_id`, `created_at` | DB 컬럼 (선택적) |

## 클래스/타입 네이밍

| 유형 | 패턴 | 예시 |
|------|------|------|
| Service | `{도메인}Service` | `PaymentService`, `UserService` |
| Controller | `{도메인}Controller` | `PaymentController` |
| Repository | `{도메인}Repository` | `UserRepository` |
| DTO | `{동작}{도메인}Request/Response` | `CreateUserRequest`, `UserResponse` |
| Exception | `{도메인}Exception` | `PaymentException`, `AuthenticationException` |
| Enum | 단수형 명사 | `PaymentStatus`, `UserRole` |
| Interface | 형용사 또는 명사 | `Cacheable`, `PaymentProcessor` |

## 함수/메서드 네이밍

| 유형 | 패턴 | 예시 |
|------|------|------|
| 조회 (단건) | `get{대상}`, `find{대상}` | `getUserById`, `findByEmail` |
| 조회 (목록) | `get{대상}s`, `list{대상}s` | `getUsers`, `listPayments` |
| 생성 | `create{대상}`, `add{대상}` | `createUser`, `addItem` |
| 수정 | `update{대상}`, `modify{대상}` | `updateUser`, `modifyStatus` |
| 삭제 | `delete{대상}`, `remove{대상}` | `deleteUser`, `removeItem` |
| 검증 | `validate{대상}`, `check{대상}` | `validateToken`, `checkPermission` |
| 변환 | `to{대상}`, `convert{대상}` | `toResponse`, `convertToEntity` |
| Boolean | `is{상태}`, `has{속성}`, `can{동작}` | `isValid`, `hasPermission`, `canDelete` |

## 변수 네이밍

| 유형 | 규칙 | 예시 |
|------|------|------|
| Boolean | `is/has/can/should` 접두사 | `isActive`, `hasPermission` |
| 컬렉션 | 복수형 사용 | `users`, `payments`, `items` |
| Map | `{key}To{value}` 또는 `{value}By{key}` | `userById`, `nameToId` |
| 카운트 | `{대상}Count` 또는 `numberOf{대상}s` | `userCount`, `numberOfItems` |
| 인덱스 | `i`, `j`, `k` 또는 `{대상}Index` | `i`, `userIndex` |

## 파일/디렉토리 네이밍

| 유형 | 규칙 | 예시 |
|------|------|------|
| 소스 파일 | 클래스명과 동일 (PascalCase) | `UserService.kt`, `PaymentController.java` |
| 테스트 파일 | `{대상}Test` 또는 `{대상}.test` | `UserServiceTest.kt`, `payment.test.ts` |
| 설정 파일 | kebab-case | `application.yaml`, `docker-compose.yml` |
| 디렉토리 | kebab-case | `user-service`, `payment-api` |

## 피해야 할 패턴

| 패턴 | 이유 | 대안 |
|------|------|------|
| `data`, `info`, `item` | 의미 불명확 | 구체적인 도메인 용어 사용 |
| `temp`, `tmp` | 목적 불명확 | 실제 용도 명시 |
| `Manager`, `Handler` 남용 | 책임 불명확 | 구체적인 역할명 사용 |
| 숫자로 구분 | `user1`, `user2` | 역할 기반 이름 사용 |
| 축약어 남용 | `usrSvc`, `pymtCtrl` | 전체 단어 사용 |

## 도메인 용어

각 도메인의 `glossary.md`에 정의된 용어를 우선 사용합니다.
도메인 용어가 없는 경우 일반적인 영어 단어를 사용합니다.
