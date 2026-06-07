# CANDID-013 — 공고 목록 조회 + 필터/정렬/페이징 + URL 쿼리 상태

> 소급 작성 문서(CANDID-063). 구현 완료. 요구사항 추적성(DS-07)용 요약·링크.
> **요구사항 SSOT**: PRD [`docs/sample-requirement.md`](../sample-requirement.md) — **US-JOB-001 (P0) 채용 공고 목록 조회** (§2.2).

## 연관 사용자 스토리
**US-JOB-001**: 방문자가 직군별 공고 목록을 보고 관심 포지션을 빠르게 찾는다.

## 핵심 요구사항 (PRD 발췌)
- **비로그인 상태에서도 접근 가능**.
- 필터: 직군(개발/디자인/기획/경영지원/…), 고용형태(정규직/계약직/인턴), 경력(신입/경력/무관).
- 정렬 + 페이징. 필터/정렬/페이지 상태는 **URL 쿼리스트링에 반영**(공유/뒤로가기 보존).
- 마감일 지난 공고는 별도 섹션 또는 흐릿 처리로 표시(**완전 숨김 X — SEO 자산 보존**).

## 관련 비즈니스 규칙 / NFR (CLAUDE.md)
- **NFR**: 공고 목록/상세 P95 < 300ms. 인메모리 캐시(`unstable_cache`/lru-cache) 활용 여지.
- **SEO**: 공고 페이지 SSR/SSG + `JobPosting` schema.org structured data(상세는 CANDID-025).
- 에러 코드: `JOB_NOT_FOUND`, `JOB_NOT_OPEN`, `JOB_CLOSED`.

## 인수 조건
- [x] 비로그인 열람 가능.
- [x] 직군/고용형태/경력 필터 + 정렬 + 페이징.
- [x] 필터·정렬·페이지 상태가 URL 쿼리에 동기화(공유/새로고침 시 복원).
- [x] 마감 공고 표시 유지(SEO 보존).

## 구현 참조
- 상태: **구현 완료**. 후속 재구성 — CANDID-050(/jobs 목록 CSS Modules 재구성).
- 주요 영역: `app/jobs/**`, `app/api/v1/jobs/**`, `lib/jobs/**`.
