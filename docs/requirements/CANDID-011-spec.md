# CANDID-011 — 이메일 로그인 + 5회 실패 잠금/15분

> 소급 작성 문서(CANDID-063). 구현 완료. 요구사항 추적성(DS-07)용 요약·링크.
> **요구사항 SSOT**: PRD [`docs/sample-requirement.md`](../sample-requirement.md) — **US-AUTH-002 (P0) 이메일 로그인** (§2.1).

## 연관 사용자 스토리
**US-AUTH-002**: 기존 회원이 이메일/비밀번호로 로그인하여 지원 내역을 관리한다.

## 핵심 요구사항 (PRD 발췌)
- 이메일/비밀번호 로그인. "로그인 상태 유지" 미체크 시 Refresh Token 만료 1일.
- 로그인 실패 횟수 제한: 동일 계정 **5회 실패 시 15분간 잠금(429 응답)**.
- 실패 메시지는 "이메일 또는 비밀번호가 일치하지 않습니다" — 어느 쪽이 틀렸는지 비노출(**계정 열거 공격 방지**).
- 로그인 직전 URL이 있으면 로그인 후 해당 URL로 복귀.
- Access Token 만료 시 Refresh Token으로 자동 갱신, 갱신 실패 시 로그인 페이지로.

## 관련 비즈니스 규칙 (CLAUDE.md)
- **BR-AUTH-03**: 로그인 5회 실패 → 15분 잠금. **성공 시 카운터 초기화**.
- 토큰: JWT Access 30분 + Refresh(HttpOnly Cookie). 시크릿은 `.env`+zod 주입, 노출 금지.
- 에러 코드: `AUTH_INVALID_CREDENTIALS`, `AUTH_ACCOUNT_LOCKED`, `AUTH_TOKEN_EXPIRED`, `AUTH_REFRESH_INVALID`.

## 인수 조건
- [x] 5회 실패 → 15분 잠금(429), 성공 시 카운터 리셋.
- [x] 실패 메시지가 이메일/비번 구분 비노출(계정 열거 방지).
- [x] 직전 URL 복귀.
- [x] Access 만료 시 Refresh 자동 갱신.

## 구현 참조
- 상태: **구현 완료**. 기반: CANDID-006(JWT/Refresh 인증), CANDID-007(에러 코드 체계).
- 주요 영역: `app/api/v1/auth/login/**`, `lib/auth/login.ts`, `lib/auth/cookies.ts`.
