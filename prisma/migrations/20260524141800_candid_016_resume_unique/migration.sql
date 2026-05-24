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

-- D-MAJOR-1 fix (PR #57 in-PR fix): CONCURRENTLY 제거. Prisma migrate deploy는 마이그 파일을
-- BEGIN..COMMIT 트랜잭션으로 자동 wrap하며 (Prisma issue #11164), CONCURRENTLY는 트랜잭션
-- 블록 안에서 실행 불가 (`cannot run inside a transaction block`). 본 마이그는 resume_files가
-- 운영 초기 소량(<1k rows 예상)이라 일반 CREATE UNIQUE INDEX의 ACCESS EXCLUSIVE 락 시간이
-- ms 수준 — 운영 적용 안전. 향후 row 수가 100k+ 규모로 커지면 별도 runbook으로 CONCURRENTLY를
-- 사전 실행 후 마이그가 IF NOT EXISTS로 no-op 되도록 운용 (현 마이그는 IF NOT EXISTS 유지).
--
-- CANDID-013 마이그(20260524072500)도 동일 CONCURRENTLY 패턴 — 별도 follow-up task로 carry.

CREATE UNIQUE INDEX IF NOT EXISTS "uk_resume_files_one_per_draft"
  ON "resume_files"("draft_id")
  WHERE "draft_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uk_resume_files_one_per_app"
  ON "resume_files"("application_id")
  WHERE "application_id" IS NOT NULL;
