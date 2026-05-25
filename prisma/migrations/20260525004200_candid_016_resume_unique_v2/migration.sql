-- CANDID-016 Step 2 (D-MAJOR-2 fix): partial UNIQUE에 virus_scan_status 조건 추가.
--
-- 배경: Step 1 마이그(20260524141800)의 partial UNIQUE는 `WHERE draft_id IS NOT NULL`만 둠 →
-- INFECTED/FAILED row가 잔존해도 UNIQUE 평가에 포함되어 사용자의 재업로드가 영구 409 차단됨.
-- 정책 결정 (사용자 확정 2026-05-25):
--   INFECTED/FAILED row는 DB에 잔존 (audit 추적/사용자 통보 후), 새 업로드는 partial UNIQUE 평가에서
--   제외하여 정상 흐름 유지. CLEAN/PENDING row만 active 첨부로 간주.
--
-- 운영 안전성: DROP INDEX + CREATE INDEX (둘 다 IF EXISTS / IF NOT EXISTS). Step 1 같은 마이그
-- 파일에서 트랜잭션 wrap 이슈 동일 — 일반 CREATE INDEX 사용 (운영 데이터 0건, 락 ms 수준).
-- L-001: 본 마이그도 destructive 아님 (INDEX 교체만).
-- L-016: WHERE 조건의 NULL semantics — `IS NOT NULL` + enum equality. enum NULL 가능성 없음
--        (Step 1 schema VirusScanStatus NOT NULL DEFAULT 'PENDING'), 따라서 UNKNOWN semantics 안전.

DROP INDEX IF EXISTS "uk_resume_files_one_per_draft";
DROP INDEX IF EXISTS "uk_resume_files_one_per_app";

CREATE UNIQUE INDEX IF NOT EXISTS "uk_resume_files_one_per_draft"
  ON "resume_files"("draft_id")
  WHERE "draft_id" IS NOT NULL AND "virus_scan_status" IN ('PENDING', 'CLEAN');

CREATE UNIQUE INDEX IF NOT EXISTS "uk_resume_files_one_per_app"
  ON "resume_files"("application_id")
  WHERE "application_id" IS NOT NULL AND "virus_scan_status" IN ('PENDING', 'CLEAN');
