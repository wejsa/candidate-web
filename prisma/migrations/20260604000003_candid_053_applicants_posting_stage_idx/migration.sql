-- CANDID-053 Step 5 — 운영자 지원자 목록 stage 필터 인덱스 (FR-006).
-- 기존 idx_applications_posting_result는 result 컬럼이라 current_stage 필터/정렬에 부적합 →
-- (job_posting_id, current_stage) 복합 인덱스로 "공고별 단계별 지원자" 조회를 인덱스로 처리한다.
-- 비-CONCURRENTLY 일반 CREATE INDEX — prisma migrate deploy의 트랜잭션 wrap과 정합(check:migrations 가드).
CREATE INDEX "idx_applications_posting_stage" ON "applications" ("job_posting_id", "current_stage");
