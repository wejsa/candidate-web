# 요구사항 문서 인덱스 (Requirements Traceability)

본 디렉터리는 기능별 요구사항을 추적한다. **요구사항의 단일 진실 소스(SSOT)는 통합 PRD
[`docs/sample-requirement.md`](../sample-requirement.md)** (US-AUTH/JOB/APP/MY 사용자 스토리 + §3 데이터 모델 + §NFR)이며,
per-task `{TASK-ID}-spec.md`는 **핵심 도메인 기능에 한해** PRD를 참조·요약하고 구현(머지 PR)을 연결하는 추적 문서다.

## 문서화 정책 (DS-07 기준)
- **핵심 도메인 기능**(US 스토리 직결: 가입/로그인/공고/지원서/마이페이지 등) → per-task `-spec.md` 보유.
- **기술/인프라/후속(FU) Task**(프로젝트 셋업, DB 스키마, 인증 기반, 보안 가드, 감사/메트릭, 카피/UI 보정 등)
  → **PRD §3·§NFR 또는 코드가 SSOT**. 별도 요구사항 스펙을 만들지 않는다(중복 회피). 본 정책은 의도적이며,
  헬스체크 DS-07의 per-task 파일 부재는 이들 Task에 대해 **오탐이 아니라 정책상 정상**이다.

## 핵심 도메인 기능 → 요구사항 출처

| Task | 기능 | US 스토리 | 요구사항 문서 |
|------|------|----------|--------------|
| CANDID-010 | 이메일 회원가입 + 인증 메일 | US-AUTH-001 | [CANDID-010-spec.md](./CANDID-010-spec.md) |
| CANDID-011 | 이메일 로그인 + 실패 잠금 | US-AUTH-002 | [CANDID-011-spec.md](./CANDID-011-spec.md) |
| CANDID-012 | 소셜 로그인(Google/GitHub) | US-AUTH-003 | PRD §2.1 US-AUTH-003 |
| CANDID-020 | 비밀번호 재설정 | US-AUTH-004 | [CANDID-020-spec.md](./CANDID-020-spec.md) |
| CANDID-021 | 로그아웃 + Refresh 블랙리스트 | US-AUTH-005 | PRD §2.1 US-AUTH-005 |
| CANDID-022 | 회원 탈퇴/익명화(GDPR) | US-AUTH-005 | PRD §2.1 US-AUTH-005 / BR-PII-03 |
| CANDID-013 | 공고 목록 + 필터/정렬/페이징 | US-JOB-001 | [CANDID-013-spec.md](./CANDID-013-spec.md) |
| CANDID-014 | 공고 상세 + sanitize HTML | US-JOB-002 | PRD §2.2 US-JOB-002 |
| CANDID-025 | SEO + JobPosting structured data | US-JOB / NFR-SEO | PRD §2.2 + NFR |
| CANDID-015 | 지원서 3단계 작성 + 자동 임시저장 | US-APP-001/002/005 | PRD §2.3 |
| CANDID-016 | 이력서 파일 첨부(Pre-signed/MIME) | US-APP-003 | PRD §2.3 / BR-FILE-01 |
| CANDID-017 | 포트폴리오 링크 + SSRF 차단 | US-APP-004 | [CANDID-017-spec.md](./CANDID-017-spec.md) |
| CANDID-018 | 지원서 최종 제출(멱등성/마감/트랜잭션) | US-APP-006 | [CANDID-018-spec.md](./CANDID-018-spec.md) |
| CANDID-019 | 마이페이지 리스트 + 전형 타임라인 | US-MY-001/002 | [CANDID-019-spec.md](./CANDID-019-spec.md) |
| CANDID-023 | 지원 철회 | US-MY-003 | [CANDID-023-spec.md](./CANDID-023-spec.md) |
| CANDID-024 | 프로필 수정 | US-MY-004 | [CANDID-024-spec.md](./CANDID-024-spec.md) |

## 기술/인프라/후속 Task (PRD/코드 SSOT)
| Task | 영역 | SSOT |
|------|------|------|
| CANDID-001 | Next.js 14 셋업 + TS/ESLint/Prettier | 코드 + CLAUDE.md |
| CANDID-002~005 | DB 스키마(Prisma) | PRD §3 데이터 모델 + `prisma/schema.prisma` |
| CANDID-006 | JWT/Refresh 인증 기반 | PRD §2.1 + 코드 |
| CANDID-007 | 전역 에러 핸들러 + 에러 코드 체계 | CLAUDE.md "에러 코드 체계" + `lib/errors/codes.ts` |
| CANDID-008/031/034 | PII 암호화(AES-256-GCM) + 방어 깊이 | CLAUDE.md BR-PII-01 + 코드 |
| CANDID-009 | Rate Limit + 보안 헤더(CSRF/CORS/XSS) | CLAUDE.md 보안 강제 + 코드 |
| CANDID-026~028 | 감사 로그 / 메트릭 / 접근성·반응형 | PRD §NFR + 코드 |
| CANDID-029 | 야간 배치(Draft 정리) | PRD §2.3 US-APP-005 + 코드 |
| CANDID-036/037 | 이메일 인증 보안 hardening(FU) | CANDID-010 후속 / 코드 |
| CANDID-057 | 지원자 대시보드 공고 제목 표시(FU) | CANDID-054 후속 |

## 기존 개별 스펙 (crew-feature 생성)
CANDID-050 / 051 / 053 / 054 / 058 / 059 — 각 `{ID}-spec.md` 참조(백오피스·전형 상태 전이·카피 등 후기 기능).

> 신규 기능은 `/crew-feature`로 `{TASK-ID}-spec.md`를 생성한다. 본 인덱스는 신규 스펙 추가 시 함께 갱신한다.
