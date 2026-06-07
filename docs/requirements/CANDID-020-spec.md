# CANDID-020 — 비밀번호 재설정

> 소급 작성 문서(CANDID-063). 구현 완료. 요구사항 추적성(DS-07)용 요약·링크.
> **요구사항 SSOT**: PRD [`docs/sample-requirement.md`](../sample-requirement.md) — **US-AUTH-004 (P1) 비밀번호 재설정** (§2.1).

## 연관 사용자 스토리
**US-AUTH-004**: 비밀번호를 잊은 사용자가 이메일을 통해 비밀번호를 재설정하여 다시 로그인한다.

## 핵심 요구사항 (PRD 발췌)
- 이메일 입력 후 재설정 메일 발송. **존재 여부와 무관하게 동일한 응답 메시지**(계정 열거 방지).
- 재설정 토큰 유효기간 **30분, 일회용**.
- 재설정 완료 시 **모든 기존 세션/리프레시 토큰 무효화**.

## 관련 비즈니스 규칙 / 보안 (CLAUDE.md)
- 계정 열거 방지: 요청 결과를 응답으로 구분하지 않음(항상 동일 200).
- 비밀번호는 **BCrypt strength 12** 해시. 재설정 토큰/링크 평문 로깅 금지.
- 토큰 해시 저장(sha256) + 일회용 소진. 메일은 트랜잭션 외부 발행(fail-open).
- 에러 코드: `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`.

## 인수 조건 (플로우 기준)
- [x] 존재 여부 무관 동일 응답(계정 열거 방지).
- [x] 토큰 30분 만료 + 일회용.
- [x] 재설정 완료 시 기존 세션/Refresh 전부 무효화.

## ⚠️ 현재 한계 (운영 전제 — 정확성 노트)
- **재설정 플로우 자체**(토큰 발급·검증·세션 무효화·균일 응답)는 **구현 완료**.
- **이메일 전송은 환경 의존이며 실사용자 수신함에는 도달하지 않는다**:
  - dev `.env`는 `SMTP_HOST=localhost:1025` + `SMTP_USER/PASS` 빈값 → 포트 1025는 **maildev/mailpit 로컬 캐처**(inbox UI `:1080`). 메일은 캐처에 잡힐 뿐 실제 메일박스로 발송되지 않는다.
  - 라우트는 `void sendMail(...).catch(...)` **fail-open**(BR-TX-02 + 계정 열거 방지) — SMTP 미구성/캐처 미기동 시 토큰만 발급되고 메일은 조용히 실패한다.
  - 따라서 **운영 SMTP가 구성되지 않은 현재, 실사용자 대상 end-to-end 비밀번호 재설정은 동작하지 않는다**(개발자는 maildev UI에서 토큰을 직접 확인해 검증 가능).
- **운영 활성화 조건**: AWS SES/SendGrid/Mailgun 등 SMTP 자격 주입(`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`) + `NODE_ENV=production`(requireTLS·인증서 검증). → 별도 운영/배포 Task로 추적 권장.

## 구현 참조
- 상태: 플로우 **구현 완료** — PR **#81, #84, #85, #86, #87**. 이메일 **전달은 운영 SMTP 미구성으로 미완**(위 한계 참조).
- 주요 영역: `app/api/v1/auth/password/**`, `lib/auth/password-reset*`, `lib/email/transport.ts`.
- 회귀 가드: `tests/lib/email/transport.test.ts`(STARTTLS prod 게이트), 비밀번호 재설정 통합 테스트.
