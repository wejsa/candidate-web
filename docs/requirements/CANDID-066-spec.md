# CANDID-066 — 백오피스 지원서 상세: 이력서 파일 + 포트폴리오 링크 열람

## 개요
운영자(RECRUITER/ADMIN)가 백오피스 지원서 상세(`/admin/applications/[id]`)에서 지원자가 제출한 **이력서 첨부 파일**과 **포트폴리오 링크**를 확인·열람할 수 있게 한다. 현재 상세 페이지는 동결 PII(이름/이메일/연락처/생년월일/주소)와 전형 이력만 노출하고, **첨부 파일·포트폴리오는 조회조차 하지 않아** 운영자가 지원자를 제대로 평가할 수 없다.

## 목적
- 채용 평가에 필수인 이력서·포트폴리오를 운영자가 안전하게 열람.
- 이력서는 PII가 담긴 민감 문서 → **역할 가드 + 감사 + 바이러스 스캔 게이팅 + 짧은 TTL presigned 다운로드**로 통제.

## 현황 분석
- `lib/admin/applicants.ts` `getApplicantDetailForOperator`: `application` 조회 시 PII snapshot + statusHistory만 select. **`resumeFiles`/`portfolioLinks` 미포함**.
- 모델: `Application.resumeFiles[]`(`ResumeFile`: originalFilename, storedPath(S3키), contentType, fileSize, checksumSha256, virusScanStatus, uploadedAt), `Application.portfolioLinks[]`(`PortfolioLink`: linkType, url, memo, sortOrder).
- 업로드는 S3/MinIO presigned **PUT**(`lib/files/storage.ts` `presignResumeUpload` + `getSignedUrl`). **다운로드(GET) presign 선례 없음 → 신규 구축**.
- 상세 페이지는 이미 `recordAuditEvent(PII_VIEW)` fail-closed 감사 수행(`lib/admin/applicants.ts:240`).
- `VirusScanStatus`: PENDING/CLEAN/INFECTED/FAILED. `PortfolioLinkType`: GITHUB/NOTION/BLOG/LINKEDIN/FIGMA/ETC.

## 기능 요구사항

### FR-001 — 운영자 상세에 첨부/포트폴리오 데이터 포함 (P0)
`getApplicantDetailForOperator` 반환에 다음 추가:
- `resumeFile`: 최대 1건(BR-FILE app당 1) — `{ id, originalFilename, contentType, fileSize, virusScanStatus, uploadedAt }`. **storedPath(S3키)는 반환 금지**(내부 경로 비노출).
- `portfolioLinks[]`: `{ id, linkType, url, memo, sortOrder }` (sortOrder 정렬, 최대 5).
- 수용 기준:
  - [ ] 첨부 없음/링크 없음도 정상(빈 배열/null) 처리.
  - [ ] storedPath·checksum 등 내부 메타는 응답에 미포함.

### FR-002 — 이력서 보안 다운로드 (P0)
신규 `GET /api/admin/v1/applications/[id]/resume` — presigned GET URL 발급(또는 302 redirect):
- 수용 기준:
  - [ ] **운영자 가드**(requireOperator) — 비운영자 403.
  - [ ] **감사 기록**: 다운로드 = 민감 행위 → `RESUME_DOWNLOAD` 감사 이벤트(또는 PII_VIEW 재사용 — 설계에서 확정). fail-closed(감사 실패 시 다운로드 거부).
  - [ ] **바이러스 스캔 게이팅**: `INFECTED` 절대 차단(409/403), `PENDING`/`FAILED`는 차단 + 사유 안내(스캔 미완/실패). `CLEAN`만 발급.
  - [ ] presigned GET **짧은 TTL**(≤60초), 1회성 성격. storedPath 직접 노출 금지.
  - [ ] 존재하지 않는 application/파일 → notFound(404), enumeration 차단.

### FR-003 — 상세 페이지 UI 렌더 (P0)
`app/admin/applications/[id]/page.tsx`에 섹션 추가:
- **첨부 파일**: 파일명·크기·업로드일·스캔 상태 배지 + "다운로드" 버튼(FR-002 호출). 스캔 미완/감염 시 버튼 비활성 + 사유.
- **포트폴리오 링크**: linkType 라벨 + URL(클릭 가능, `target="_blank" rel="noopener noreferrer"`) + memo. "외부 비공개 페이지는 접근 불가할 수 있음" 안내.
- 수용 기준:
  - [ ] 첨부/링크 없으면 "없음" 표시.
  - [ ] 외부 링크는 noopener/noreferrer로 렌더(탭재킹 방지).
  - [ ] 철회(WITHDRAWN) 지원서도 열람 가능(평가 이력 보존) — 단 쓰기 컨트롤은 기존대로 비노출.

## 비기능 요구사항
- **보안**:
  - 이력서 = PII 문서 → 다운로드 역할 가드 + 감사 + virus-scan 게이팅. presigned TTL ≤60초.
  - storedPath(S3 키)·checksum 등 내부 메타 응답 비노출.
  - 포트폴리오 외부 링크는 **표시 전용**(서버 fetch 없음 → SSRF 무관). `rel="noopener noreferrer"` 필수.
  - 평문 PII·파일 내용은 감사 metadata에 미기록(BR-PII-01).
- **성능**: 상세 조회에 resumeFiles/portfolioLinks join 1회 추가(N+1 없이 단일 쿼리 include).
- **확장성**: 파일 app당 1건·포트폴리오 5건 상한은 기존 제약 그대로.

## 기술 스펙
- **영향 범위**:
  - `lib/admin/applicants.ts` — `ApplicantDetail` 타입 + `getApplicantDetailForOperator` select 확장.
  - `lib/files/storage.ts` — `presignResumeDownload`(GetObjectCommand + getSignedUrl) 신규.
  - `app/api/admin/v1/applications/[id]/resume/route.ts` — 신규 GET(가드+감사+게이팅+presign).
  - `app/admin/applications/[id]/page.tsx` + 컴포넌트(다운로드 버튼은 client) — UI 섹션.
  - `prisma/schema.prisma` + migration — `AuditEventType`에 `RESUME_DOWNLOAD` 추가 시(설계 확정 후). PG enum 추가는 additive(안전)이나 migration 필요.
- **통신 방식**: REST (presigned URL 다운로드). 실시간/스트리밍 불필요.
- **API 변경**: `GET /api/admin/v1/applications/[id]/resume` 신규. 기존 엔드포인트 변경 없음.
- **에러 코드**: `FILE_NOT_FOUND`(또는 APP_* 재사용), `AUTH_FORBIDDEN`, virus 게이팅용 코드(`FILE_SCAN_PENDING`/`FILE_INFECTED` 신규 검토 — `ERROR_CATALOG` 우선 갱신).

## 의존성 / 전제
- ⚠️ **S3/MinIO 스토리지 운영 구성 전제**: presigned PUT은 구현됐으나, 다운로드도 동일 인프라 의존. dev(MinIO)/운영 스토리지 미구성 시 실제 파일 열람 불가(이메일 전달 갭과 유사한 운영 전제). 본 Task는 **앱 기능**을 구현하며, 스토리지 운영 구성은 별도.
- CANDID-016(이력서 업로드), CANDID-017(포트폴리오 링크), CANDID-053(백오피스 상세), CANDID-026(감사) 기반.

## 테스트 계획
- 단위: 서비스가 resumeFile/portfolioLinks 포함 + storedPath 미노출. presign-download 가드(role 403 / virus 게이팅 / 감사 fail-closed / 404 enumeration).
- 컴포넌트: 상세 UI에 파일 메타·다운로드 버튼·포트폴리오 링크(noopener) 렌더, 빈 케이스, 스캔 상태별 버튼 상태.
- 통합: 운영자 다운로드 happy path(presigned URL 발급 + 감사 1건) + INFECTED 차단.

## 참고자료
- PRD `docs/sample-requirement.md` — US-APP-003(이력서), US-APP-004(포트폴리오).
- CLAUDE.md — BR-FILE-01, BR-PII-01, 보안 강제(파일 MIME/UUID, 감사).
- 관련 spec: [CANDID-017](./CANDID-017-spec.md), 기존 코드 `lib/files/`, `lib/admin/applicants.ts`.
