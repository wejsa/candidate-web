-- CANDID-013 Step 1 — JobPosting 목록 조회 최적화 partial index 4종.
--
-- (A) idx_jp_active_opens_desc       — 활성 공고 최신순(기본 정렬)
-- (B) idx_jp_active_closes_asc       — 활성 공고 마감임박순 (NULLS LAST: 상시모집은 뒤로)
-- (C) idx_jp_active_cat_opens_desc   — 활성 공고 카테고리 필터 + 최신순 복합
-- (D) idx_jp_closed_recent           — 마감 공고 별도 섹션 (최근 마감 우선)
--
-- Prisma `@@index`는 partial index 미지원이라 수동 SQL.
-- `CREATE INDEX CONCURRENTLY` 사용 — prod 적용 시 락 회피 (prisma migrate deploy는
-- 명령을 트랜잭션으로 wrap하지 않으므로 CONCURRENTLY 사용 가능).
-- IF NOT EXISTS로 idempotent — 재실행 안전.
--
-- 기존 idx_job_postings_status_closes_at 는 본 마이그에서 유지. 1릴리스 운영 관찰 후
-- 중복 여부 판단하여 별도 task에서 DROP 결정 (plan F-4 follow-up).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_jp_active_opens_desc"
    ON "job_postings" ("opens_at" DESC, "id" DESC)
    WHERE "status" = 'OPEN';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_jp_active_closes_asc"
    ON "job_postings" ("closes_at" ASC NULLS LAST, "id" DESC)
    WHERE "status" = 'OPEN';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_jp_active_cat_opens_desc"
    ON "job_postings" ("job_category_id", "opens_at" DESC, "id" DESC)
    WHERE "status" = 'OPEN';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_jp_closed_recent"
    ON "job_postings" ("closes_at" DESC, "id" DESC)
    WHERE "status" = 'CLOSED';
