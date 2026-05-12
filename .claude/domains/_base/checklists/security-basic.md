# 기본 보안 체크리스트

모든 도메인에 적용되는 기본 보안 체크리스트입니다.
도메인별 추가 보안 요구사항은 각 도메인의 `checklists/security.md`를 참조하세요.

## 인증/인가

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 인증 필수 | 보호 리소스 접근 시 인증 확인 | CRITICAL |
| 인가 검증 | 리소스별 권한 확인 | CRITICAL |
| 세션 관리 | 안전한 세션 ID 생성 및 관리 | CRITICAL |
| 비밀번호 정책 | 최소 길이, 복잡도 요구 | MAJOR |

## 입력 검증

| 항목 | 설명 | 심각도 |
|------|------|--------|
| SQL Injection | PreparedStatement, ORM, 파라미터 바인딩 사용 | CRITICAL |
| XSS 방지 | 출력 시 HTML 이스케이프 | CRITICAL |
| Path Traversal | 파일 경로 검증 | CRITICAL |
| 입력 길이 | 최대 길이 제한 | MAJOR |
| 타입 검증 | 예상 타입과 일치 여부 확인 | MAJOR |
| Python: f-string SQL 금지 | `f"SELECT..."` 금지, `text()` + bindparams 필수 | CRITICAL |
| Python: eval/exec 금지 | 사용자 입력 코드 실행 금지 | CRITICAL |
| Python: pickle 역직렬화 | 신뢰할 수 없는 데이터 `pickle.loads` 금지 | CRITICAL |

## 민감정보 보호

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 평문 저장 금지 | 비밀번호 해시 저장 (bcrypt/argon2) | CRITICAL |
| 로깅 금지 | 비밀번호, 토큰, API 키 로깅 금지 | CRITICAL |
| 마스킹 | 민감정보 출력 시 마스킹 | MAJOR |
| 환경변수 | 민감정보는 환경변수로 관리 | MAJOR |
| Python: pydantic-settings | `os.environ` 직접 접근 대신 `pydantic-settings` 사용 | MAJOR |
| Python: CORS wildcard | `allow_origins=["*"]` 프로덕션 금지 | CRITICAL |

## 통신 보안

| 항목 | 설명 | 심각도 |
|------|------|--------|
| HTTPS | 프로덕션 환경 HTTPS 필수 | CRITICAL |
| 인증서 검증 | SSL 인증서 검증 활성화 | CRITICAL |
| API 키 보호 | 클라이언트 노출 금지 | MAJOR |

## 에러 처리

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 스택 트레이스 | 프로덕션에서 노출 금지 | MAJOR |
| 상세 에러 | 내부 정보 노출 금지 | MAJOR |
| 일관된 응답 | 인증 실패 시 동일 메시지 | MINOR |

## 의존성 보안

| 항목 | 설명 | 심각도 |
|------|------|--------|
| 취약점 스캔 | 알려진 취약점 검사 | MAJOR |
| 버전 관리 | 보안 패치 적용 | MAJOR |
| 불필요한 의존성 | 사용하지 않는 라이브러리 제거 | MINOR |

## 사용 방법

이 체크리스트는 `skill-review`, `skill-review-pr` 실행 시 자동으로 로드됩니다.
도메인별 보안 요구사항(PCI-DSS, HIPAA 등)은 해당 도메인 체크리스트에서 추가됩니다.
