-- CANDID-016 Step 1: 이력서 첨부 "최대 1개" DB 강제
--
-- 배경: US-APP-003 — "최대 첨부 개수 1개(교체 시 기존 파일 즉시 삭제 큐 등록)".
-- 동시 탭/race condition 방어를 앱 레이어만으로 보장하기 곤란 → DB partial UNIQUE로 강제.
-- 부모(application/draft) FK ON DELETE SET NULL과 호환되도록 WHERE NOT NULL 조건 사용:
--   orphan row(둘 다 NULL — BR-PII-03 메타 보존)는 partial UNIQUE 평가 대상 외.
--
-- 운영 안전성 (L-001): 본 마이그는 destructive 아님 (INDEX 추가만). 단, 적용 전 중복 row가 있으면
-- INDEX 생성 실패. 운영 데이터 없음(dev only) 가정. 도입 후 운영에서 적용 시 사전 가드 query:
--   SELECT draft_id, COUNT(*) FROM resume_files WHERE draft_id IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1;
--   SELECT application_id, COUNT(*) FROM resume_files WHERE application_id IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1;
-- 둘 다 0건이어야 안전.
--
-- L-016: WHERE 조건의 NULL semantics — `IS NOT NULL` 명시. partial UNIQUE는 인덱스 entry 자체가
-- 만들어지지 않으므로 NULL row 다중 허용은 자동 (NULL=NULL이 UNKNOWN인 SQL semantics와 호환).

-- CONCURRENTLY: 운영 적용 시 ACCESS EXCLUSIVE 락 회피 (Prisma migrate deploy는 마이그를
-- 트랜잭션으로 wrap하지 않으므로 CONCURRENTLY 사용 가능 — CANDID-013 마이그와 동일 패턴).
-- IF NOT EXISTS: 재실행 안전 (idempotent).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "uk_resume_files_one_per_draft"
  ON "resume_files"("draft_id")
  WHERE "draft_id" IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "uk_resume_files_one_per_app"
  ON "resume_files"("application_id")
  WHERE "application_id" IS NOT NULL;
