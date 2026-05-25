-- CANDID-038: CANDID-013(20260524072500) 마이그의 CREATE INDEX CONCURRENTLY 제거 (L-029 회귀 회피).
--
-- 배경: Prisma `migrate deploy`는 마이그 파일을 BEGIN..COMMIT 트랜잭션으로 자동 wrap (prisma issue #11164).
--       PostgreSQL `CREATE INDEX CONCURRENTLY`는 트랜잭션 블록 안에서 실행 불가 → 운영 첫 배포 시
--       `ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`로 100% 실패.
--       L-029, `_base/conventions/database.md` §"Prisma migrate deploy의 트랜잭션 wrap" 참조.
--
-- 방침: CANDID-013 v1 마이그 파일은 Prisma migration history integrity를 위해 보존 (수정 없음).
--       본 신규 마이그가 DROP+CREATE로 인덱스를 재구축하여 일반 CREATE INDEX로 전환.
--       선례: CANDID-016 v2(20260525004200) 동일 패턴.
--
-- 운영 안전성:
--  - L-001 destructive 아님 (INDEX 정의 동일, 컬럼/WHERE 변경 없음 → 쿼리 플랜 영향 0).
--  - `job_postings` 운영 row 수 0건 (pre-launch). 일반 CREATE INDEX의 ACCESS EXCLUSIVE 락 시간 ms 수준.
--  - 트랜잭션 원자성: DROP과 CREATE가 같은 BEGIN..COMMIT에서 실행 → 인덱스 없는 window 0초.
--  - row 수 100k+ 도달 시점에는 별도 runbook으로 `psql -c "CREATE INDEX CONCURRENTLY ..."`
--    사전 실행 + 마이그는 IF NOT EXISTS no-op으로 운용 (database.md L-029 옵션 2).
--
-- 회귀 가드: `pnpm check:migrations` (scripts/check-migrations-no-concurrently.mjs) — CANDID-013 legacy
--           파일만 allowlist 등록, 신규 CONCURRENTLY 추가는 차단.

DROP INDEX IF EXISTS "idx_jp_active_opens_desc";
DROP INDEX IF EXISTS "idx_jp_active_closes_asc";
DROP INDEX IF EXISTS "idx_jp_active_cat_opens_desc";
DROP INDEX IF EXISTS "idx_jp_closed_recent";

CREATE INDEX IF NOT EXISTS "idx_jp_active_opens_desc"
    ON "job_postings" ("opens_at" DESC, "id" DESC)
    WHERE "status" = 'OPEN';

CREATE INDEX IF NOT EXISTS "idx_jp_active_closes_asc"
    ON "job_postings" ("closes_at" ASC NULLS LAST, "id" DESC)
    WHERE "status" = 'OPEN';

CREATE INDEX IF NOT EXISTS "idx_jp_active_cat_opens_desc"
    ON "job_postings" ("job_category_id", "opens_at" DESC, "id" DESC)
    WHERE "status" = 'OPEN';

CREATE INDEX IF NOT EXISTS "idx_jp_closed_recent"
    ON "job_postings" ("closes_at" DESC, "id" DESC)
    WHERE "status" = 'CLOSED';
