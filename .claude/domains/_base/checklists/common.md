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

## ORM 에러 매핑 (L-030)

| 항목 | 설명 | 심각도 |
|------|------|--------|
| **P2002 unique violation 매핑** | Prisma `P2002`를 도메인 에러로 매핑할 때 반드시 `err.meta.target` (string \| string[])을 화이트리스트 컬럼 집합과 교집합 검사. target 검증 없이 모든 P2002를 단일 에러로 매핑하면, 향후 같은 모델에 다른 UNIQUE 인덱스(예: checksum 등) 추가 시 오매핑 + 사용자 오안내. SSOT 헬퍼(`lib/db/prisma-errors.ts` 또는 도메인별 모듈)로 추출 권장. | **MAJOR** |
| 외부 SDK cause leak | AWS SDK / 외부 라이브러리 에러를 `AppError({cause})` 그대로 전달 금지. `safeXxxCause(cause)` 화이트리스트 헬퍼로 `{name, statusCode, requestId}` 등 안전 필드만 추출 후 plain object 전달. requestId/signedURL/credentials 일부가 로깅 sink(Sentry/pino) 직렬화로 누출되는 사고 차단. 회귀 가드: 화이트리스트 외 필드 부재 단언 + JSON.stringify 결과에 민감 토큰 미포함 단언. (L-032) | **MAJOR** |

> 본 항목은 CANDID-016 회고(L-030, L-032)에서 도입.

## 회귀 가드 도구 도입 (L-034 / L-035 / L-036)

| 항목 | 설명 | 심각도 |
|------|------|--------|
| **가드 자체 단위 테스트 동반** | 회귀 가드 스크립트(정규식/AST/grep 기반 검출 도구)를 도입하는 PR은 가드 *자체의* 단위 테스트(tmpdir fixture 기반 ≥ 6 케이스 — positive/negative/comment/multiline/edge)를 동반해야 한다. 가드는 무성 실패 시 차단 효과 0이고 그 사실조차 탐지 불가. 별도 follow-up 분리는 가드 무결성 검증 공백 기간을 만든다. (L-034) | **MAJOR** |
| **자동 호출 wiring 동반** | README/CONVENTION에 "PR 리뷰에서 호출", "CI에서 차단" 같은 자동화 선언을 추가하는 시점에 (a) 실제 wiring(CI workflow, husky hook, skill-review-pr SKILL.md hook 절차) 동반 또는 (b) 즉시 follow-up task 등록 중 택1 필수. 휴먼 수동 호출 의존 시 누적 회귀 발생. wiring SSOT: `skill-review-pr/SKILL.md` §2.4 declarative 매핑 표 (CANDID-042부터 구현). 신규 가드 추가 시 본 표에 행 등록 필수. (L-036) | **MAJOR** |
| **정규식 멀티라인 false-negative 회피** | SQL/코드의 라인 단위(`RX.test(lines[i])`) 매칭은 토큰 간 줄바꿈을 합법으로 허용하는 언어(PostgreSQL DDL 등)에서 우회 가능. 파일 전체 매칭 + `stripSqlComments`(주석 공백 치환, 라인 보존) + `match.index → 라인 번호 재계산` 패턴 권장. (L-035) | **MAJOR** |

> 본 항목은 CANDID-038 회고(L-034, L-035, L-036)에서 도입. CANDID-038 가드 도입 PR(#60)에서 가드 자체 vitest 부재가 3개 리뷰 에이전트(domain/security/test) MUST 지적 → follow-up 분리 시 무결성 공백 학습.

## 사용 방법

이 체크리스트는 `skill-review`, `skill-review-pr` 실행 시 자동으로 로드됩니다.
도메인별 체크리스트와 병합되며, 중복 항목은 도메인 설정이 우선합니다.
