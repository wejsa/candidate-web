# CANDID-018 — 지원서 최종 제출 (Idempotency-Key · 마감 검증 · 트랜잭션)

> 소급 작성 문서(CANDID-063). 구현 완료. 요구사항 추적성(DS-07)용 요약·링크.
> **요구사항 SSOT**: PRD [`docs/sample-requirement.md`](../sample-requirement.md) — **US-APP-006 (P0) 지원서 최종 제출** (§2.3).

## 연관 사용자 스토리
**US-APP-006**: 작성을 마친 지원자가 지원서를 최종 제출하여 채용 절차를 시작한다.

## 핵심 요구사항 (PRD 발췌)
- 제출 전 필수 검증: 모든 필수 필드 + 이력서 1개 이상 + **이메일 인증 완료** + 개인정보 수집·이용 동의(제출 직전).
- 제출 직전 최종 확인 모달(미리보기 + 수정/제출).
- 제출 후: Draft → Application 전환(또는 Draft 삭제 + Application 신규), 동일 공고 재지원 불가, 제출 완료 페이지(지원 번호 + 다음 단계), 확인 이메일 발송, Slack 알림 이벤트 발행.

## 관련 비즈니스 규칙 (CLAUDE.md)
- **BR-APP-01**: 동일 사용자 × 동일 공고 활성 지원서(`result != WITHDRAWN`)는 1건만 — DB 제약 + 트랜잭션 검증.
- **BR-APP-03/04**: 제출 시점 `closes_at < now`는 **422**(작성 중 마감 방어).
- **BR-APP-05**: `application_number` = `A-YYYYMM-NNNNN` 발급.
- **BR-APP-06**: 멱등성 키(`Idempotency-Key`) 24시간 동일 응답.
- **BR-AUTH-04**: 이메일 미인증 사용자 **제출 시점** 차단.
- **BR-TX-01**: 제출 = Application 생성 + Draft 삭제 + 이력 생성 **단일 트랜잭션**.
- **BR-TX-02**: 외부 호출(이메일/Slack)은 트랜잭션 **외부**에서 이벤트 발행 후 비동기.

## 인수 조건
- [x] 마감일 이후 제출 차단(422).
- [x] 중복 제출 방지: 멱등성 키 + `UNIQUE(user_id, job_posting_id) WHERE result != WITHDRAWN`.
- [x] 제출 처리 중 네트워크 단절 시 서버 멱등 처리(재시도 안전).

## ⚠️ 외부 알림 전달 한계 (정확성 노트)
- 제출 **플로우**(검증·트랜잭션·멱등성·지원번호 발급)는 구현 완료, 실제 동작.
- 단, **확인 이메일 발송**과 **Slack 알림**은 외부 연동 의존이며 fire-and-forget(BR-TX-02): 운영 SMTP/Slack Webhook 미구성 시 **전달되지 않는다**(제출 자체는 차단되지 않음). 메일 전달 한계 상세는 [CANDID-020-spec.md](./CANDID-020-spec.md) "현재 한계" 참조.

## 구현 참조
- 상태: 제출 플로우 **구현 완료** — PR **#67**(DB 마이그/멱등성 store), **#68**(submit 비즈니스 + validate + 트랜잭션), **#69**(Route Handler POST + 멱등성 미들웨어 + 통합 테스트 25케이스). (확인 메일/Slack 전달은 위 한계 참조)
- 주요 영역: `app/api/v1/applications/**`, `lib/applications/{submit,validate,number-generator}.ts`, `lib/idempotency/**`.
