# 공통 코드 품질 체크리스트

모든 도메인에 적용되는 기본 코드 품질 체크리스트입니다.

## 코드 품질

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 중복 코드 | 동일/유사 로직 반복 금지 | MAJOR |
| 복잡도 | 함수당 순환 복잡도 10 이하 | MAJOR |
| 함수 길이 | 함수당 50줄 이하 권장 | MINOR |
| 매직 넘버 | 상수로 분리하여 의미 부여 | MINOR |
| 네이밍 | 의미 있는 변수/함수명 사용 | MINOR |
| 주석 | 불필요한 주석 제거, 필요한 곳에만 | INFO |

## 에러 처리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 예외 처리 | 적절한 예외 타입 사용 | MAJOR |
| 빈 catch 블록 | 예외 무시 금지 | CRITICAL |
| 에러 메시지 | 디버깅 가능한 정보 포함 | MINOR |
| 리소스 정리 | try-with-resources 또는 finally 사용 | MAJOR |

## 테스트 품질

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 커버리지 | 80% 이상 권장 | MAJOR |
| 단위 테스트 | 모든 public 메서드 테스트 | MAJOR |
| 실패 케이스 | 예외 상황 테스트 필수 | MAJOR |
| 경계값 테스트 | null, empty, max 값 테스트 | MINOR |
| 테스트 격리 | 테스트 간 의존성 없음 | MAJOR |
| 테스트 명명 | 테스트 의도가 명확한 이름 | MINOR |
| 주석 처리된 코드 | 테스트 파일에 주석 처리된 assertion/검증 코드 금지 (빌드 게이트 우회 방지) | MAJOR |
| Python: pytest fixture | conftest.py에 DB/client fixture 정의 (트랜잭션 롤백) | MAJOR |
| Python: async 테스트 | `pytest-asyncio` + `asyncio_mode = "auto"` 설정 | MAJOR |
| Python: API 테스트 | `httpx.AsyncClient` + `ASGITransport` 사용 (FastAPI) | MAJOR |
| Python: 외부 호출 Mock | `requests` 직접 호출 금지, `respx` 또는 `httpx.MockTransport` 사용 | MAJOR |

## 의존성 관리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 순환 의존 | 패키지 간 순환 의존 금지 | CRITICAL |
| 계층 위반 | 상위 계층에서 하위 계층만 참조 | MAJOR |
| 외부 의존성 | 필요한 라이브러리만 사용 | MINOR |

## 로깅

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 로그 레벨 | 적절한 레벨 사용 (ERROR/WARN/INFO/DEBUG) | MINOR |
| 컨텍스트 | 디버깅에 필요한 정보 포함 | MINOR |
| 성능 | 불필요한 로깅 제거 | MINOR |

## 사용 방법

이 체크리스트는 `skill-review`, `skill-review-pr` 실행 시 자동으로 로드됩니다.
도메인별 체크리스트와 병합되며, 중복 항목은 도메인 설정이 우선합니다.
