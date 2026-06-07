# CANDID-024 — 프로필 정보 수정

> 소급 작성 문서(CANDID-063). 구현 완료. 요구사항 추적성(DS-07)용 요약·링크.
> **요구사항 SSOT**: PRD [`docs/sample-requirement.md`](../sample-requirement.md) — **US-MY-004 (P1) 프로필 정보 수정** (§2.4).

## 연관 사용자 스토리
**US-MY-004**: 지원자가 프로필 정보를 수정한다.

## 핵심 요구사항 (PRD 발췌)
- 수정 가능 항목: **이름, 연락처, 비밀번호**.
- 이메일 변경: P2(별도 인증 플로우 필요 — 본 범위 외).
- 소셜 계정 연결 추가/해제.

## 관련 비즈니스 규칙 / 보안 (CLAUDE.md)
- **BR-PII-01**: 연락처(`phone`) 등 PII는 AES-256-GCM 컬럼 암호화 + **응답 마스킹**. User PII write는 `encryptUserPiiInput` 의무.
- 비밀번호 변경 시 **BCrypt strength 12** 재해시. 변경 후 세션 정책(재로그인/세션 유지)은 구현 결정.
- 소셜 연결 정책: 동일 이메일 자동 연결 금지(본인 확인 후 명시 연결) — US-AUTH-003 정책과 일관.

## 인수 조건
- [x] 이름/연락처/비밀번호 수정.
- [x] 연락처 등 PII 저장 시 암호화 + 응답 마스킹.
- [x] 이메일 변경은 범위 외(P2)로 분리.

## 구현 참조
- 상태: **구현 완료** — PR **#93, #95, #97, #99, #100**.
- 주요 영역: `app/my/profile/**`, `app/api/v1/users/me/**`, `lib/user/**`(PII wiring `encryptUserPiiInput`).
