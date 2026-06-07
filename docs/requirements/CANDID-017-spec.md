# CANDID-017 — 외부 포트폴리오 링크 + URL 검증 + SSRF 차단

> 소급 작성 문서(CANDID-063). 구현 완료. 요구사항 추적성(DS-07)용 요약·링크.
> **요구사항 SSOT**: PRD [`docs/sample-requirement.md`](../sample-requirement.md) — **US-APP-004 (P0) 외부 포트폴리오 링크 입력** (§2.3).

## 연관 사용자 스토리
**US-APP-004**: 지원자가 Notion/GitHub/블로그 등 외부 링크를 첨부해 작업물을 어필한다.

## 핵심 요구사항 (PRD 발췌)
- 링크 입력 슬롯 **최대 5개**. 각 슬롯: `링크 타입(enum) + URL + 메모(선택)`.
- 링크 타입: `GITHUB`, `NOTION`, `BLOG`, `LINKEDIN`, `FIGMA`, `ETC`.
- URL 검증: `https?://` 시작 + 도메인 유효성. 타입별 도메인 화이트리스트(권장: GITHUB→github.com, NOTION→notion.so/notion.site 등).
- **링크 미리보기(OG 태그) 자동 추출(P1)**: 서버 fetch 시 **SSRF 주의** — 내부망 IP 차단, 리다이렉트 제한, 타임아웃 3초.
- 비공개 노션 등은 "공개 설정 확인" 안내 문구 노출.

## 관련 보안 규칙 (CLAUDE.md)
- **보안 강제**: 외부 URL fetch(OG 미리보기 등) 시 **SSRF 차단** — 내부망 IP(10./172.16-31./192.168./127./169.254.) 거부, **3초 타임아웃, 1MB 응답 제한**.
- 사용자 입력 메모/URL은 DOMPurify 화이트리스트 sanitize(저장+출력 이중 방어).

## 인수 조건
- [x] 링크 슬롯 최대 5개, 타입 enum + URL + 메모.
- [x] `https?://` 형식 + 도메인 검증.
- [x] OG fetch 시 내부망 IP 거부 + 3초 타임아웃 + 1MB 제한(SSRF 방어).

## 구현 참조
- 상태: **구현 완료**. 지원서 작성 폼(CANDID-015) 일부로 통합.
- 주요 영역: `lib/security/ssrf*`, `lib/drafts/**`, `app/jobs/[id]/apply/_components/**`.
