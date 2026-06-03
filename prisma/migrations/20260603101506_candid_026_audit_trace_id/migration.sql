-- CANDID-026 Step 1 — audit_logs.trace_id 추가 + partial 인덱스 (분산 추적 전파).
--
-- 비파괴적 변경: 추가 전용 · NULL 허용 컬럼이라 테이블 재작성/락이 없다(무중단). 따라서
-- Destructive migration guard(COUNT(*) > 0 abort) 불필요. 기존 row는 trace_id NULL로 남는다
-- (과거 요청의 traceId는 백필 불가 — 영구 NULL 허용).

ALTER TABLE "audit_logs" ADD COLUMN "trace_id" VARCHAR(36);

-- partial 인덱스 — Prisma @@index는 WHERE 절을 표현하지 못해 raw SQL로 생성한다.
-- "특정 요청(traceId)에서 발생한 모든 감사 이벤트" 조회용. NULL row(과거 데이터)는 인덱스에서 제외해
-- 인덱스 비대를 막는다.
-- 주의: prisma migrate deploy는 마이그레이션을 단일 트랜잭션으로 감싸므로 CONCURRENTLY 금지.
--       audit_logs는 운영 초기 소량이라 일반 CREATE INDEX의 짧은 락 허용.
CREATE INDEX "idx_audit_trace" ON "audit_logs" ("trace_id") WHERE "trace_id" IS NOT NULL;
