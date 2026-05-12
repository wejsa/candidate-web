# 헬스케어 / 의료 도메인

PHI 보호, 진료기록, 처방, 환자 동의, 보험 청구 등 헬스케어 서비스 개발에 필요한 도메인 지식을 제공합니다.

## 참고자료

| 문서 | 내용 |
|------|------|
| phi-data-handling.md | PHI 18개 식별자, 비식별화, 암호화, 로깅 금지 |
| access-control.md | 역할 기반 접근, Break-the-Glass, FHIR 리소스 |
| audit-trail.md | 감사 로그 필수 이벤트, 불변성, 보존 기간 |
| consent-management.md | 동의 상태머신, 동의 유형, 철회, 응급 예외 |
| prescription-flow.md | 처방 상태머신, 약물 상호작용, 용량 검증 |
| appointment-flow.md | 예약 상태머신, 접수/진료/수납 플로우 |
| billing-claims.md | 보험 청구 상태머신, 급여/비급여, 심사 |

## 체크리스트

| 체크리스트 | 내용 |
|-----------|------|
| security.md | PHI 암호화, 접근 통제, Break-the-Glass, 전송 보안 |
| compliance.md | HIPAA Privacy/Security Rule, 의료법, 개인정보보호법, 생명윤리법 |
| domain-logic.md | 처방/예약/동의 상태 전이, 약물 상호작용, 환자 식별 |

## 컴플라이언스

- **HIPAA** — PHI 보호 (Privacy Rule + Security Rule)
- **의료법** — 진료기록 작성/보존, 의료행위 기준
- **개인정보보호법** — 민감정보(건강정보) 처리 제한 (제23조)
- **생명윤리법** — 임상시험 데이터, 유전정보 (해당 시 적용)
- **진료기록보존규정** — 진료기록 10년, 처방전 2년 보존
